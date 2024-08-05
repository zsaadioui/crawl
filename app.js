// Copyright 2021 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import express from "express";
import { pinoHttp, logger } from "./utils/logging.js";
import { gotScraping } from "got-scraping";
import cheerio from "cheerio";
import getHrefs from "get-hrefs";
import { removeStopwords, eng as englishStopwords } from "stopword";
import CacheableLookup from "cacheable-lookup";

const app = express();

// Use request-based logger for log correlation
app.use(pinoHttp);

// Add this line to parse JSON request bodies
app.use(express.json());

const excludedExtensions =
  /\.(js|css|png|jpe?g|gif|wmv|mp3|mp4|wav|pdf|docx?|xls|zip|rar|exe|dll|bin|pptx?|potx?|wmf|rtf|webp|webm)$/i;

// Optimize Got Scraping
const cacheable = new CacheableLookup();

const optimizedGotScraping = gotScraping.extend({
  timeout: {
    request: 30000, // Increase to 30 seconds
  },
  dnsCache: cacheable,
  headerGeneratorOptions: {
    browsers: [
      {
        name: "chrome",
        minVersion: 87,
        maxVersion: 89,
      },
    ],
    devices: ["desktop"],
    locales: ["en-US"],
    operatingSystems: ["windows"],
  },
});

const extractTextFromHTML = (html, url) => {
  const $ = cheerio.load(html);

  // Process img elements
  $("img").each((i, elem) => {
    const $elem = $(elem);
    const src = $elem.attr("src");
    const alt = $elem.attr("alt");
    const title = $elem.attr("title");
    const figcaption = $elem.closest("figure").find("figcaption").text().trim();

    let imgInfo = "[Image";
    if (src) imgInfo += ` src="${src}"`;
    if (alt) imgInfo += ` alt="${alt}"`;
    if (title) imgInfo += ` title="${title}"`;
    if (figcaption) imgInfo += ` caption="${figcaption}"`;
    imgInfo += "]";

    $elem.replaceWith(` ${imgInfo} `);
  });

  // Remove style, script, and other non-content elements
  $(
    "style, script, noscript, iframe, object, embed, header, nav, footer, [hidden], [style=display:none], [aria-hidden=true]"
  ).remove();

  // Extract text content from the body and trim leading/trailing whitespace
  const text = $("body").text().trim();

  // Replace multiple spaces and newlines with a single space
  let cleanedText = text.replace(/\s\s+/g, " ").replace(/\n/g, " ").trim();

  // Remove stopwords
  const wordsArray = cleanedText.split(/\s+/);
  const cleanWordsArray = removeStopwords(wordsArray, englishStopwords);
  cleanedText = cleanWordsArray.join(" ");

  // Extract meta tags
  const metaDescription = $("meta[name='description']").attr("content") || "";
  const metaTitle = $("title").text() || "";
  const canonicalLink = $("link[rel='canonical']").attr("href") || "";
  const canonical = canonicalLink ? new URL(canonicalLink, url).href : "";

  // Extract URLs
  const baseUrl = new URL(url).origin;
  const hrefs = getHrefs(html, { baseUrl });
  const urls = hrefs.filter((href) => {
    try {
      const parsedUrl = new URL(href, url);
      return (
        parsedUrl.origin === baseUrl &&
        !excludedExtensions.test(parsedUrl.pathname)
      );
    } catch (e) {
      return false;
    }
  });

  // Returning all the gathered data
  return {
    html: html,
    text: cleanedText,
    metaDescription,
    metaTitle,
    url,
    canonical,
    canonicalLink,
    urls,
  };
};

// Example endpoint
app.post("/", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  try {
    logger.info({ url }, "Starting request");
    const startTime = Date.now();

    const { body } = await optimizedGotScraping.get(url, {
      responseType: "text",
    });
    logger.info({ url, fetchTime: Date.now() - startTime }, "Fetched URL");

    const result = extractTextFromHTML(body, url);
    logger.info(
      { url, totalTime: Date.now() - startTime },
      "Finished processing"
    );

    res.json(result);
  } catch (err) {
    logger.error({ err, url }, "Error fetching the URL");
    if (err.name === "TimeoutError") {
      return res.status(504).json({ error: "Request timed out" });
    }
    if (err.name === "HTTPError") {
      return res.status(err.response.statusCode).json({ error: err.message });
    }
    res.status(500).json({ error: "Error fetching the URL" });
  }
});

export default app;
