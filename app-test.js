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

const app = express();

// Use request-based logger for log correlation
app.use(pinoHttp);

// Add this line to parse JSON request bodies
app.use(express.json());

const noiseWords = [
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "from",
  "by",
  "for",
  "of",
  "with",
  "without",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "can",
  "could",
  "will",
  "would",
  "should",
  "may",
  "might",
  "must",
  "shall",
];

const stopWords = [
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "he",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "that",
  "the",
  "to",
  "was",
  "were",
  "will",
  "with",
];

const excludedExtensions =
  /\.(js|css|png|jpe?g|gif|wmv|mp3|mp4|wav|pdf|docx?|xls|zip|rar|exe|dll|bin|pptx?|potx?|wmf|rtf|webp|webm)$/i;

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
    "style, script, noscript, iframe, object, embed, [hidden], [style=display:none], [aria-hidden=true]"
  ).remove();

  // Extract text content from the body and trim leading/trailing whitespace
  const text = $("body").text().trim();

  // Replace multiple spaces and newlines with a single space
  let cleanedText = text.replace(/\s\s+/g, " ").replace(/\n/g, " ").trim();

  // Combine both noiseWords and stopWords into one set for efficient lookup
  const combinedWords = new Set([...noiseWords, ...stopWords]);

  // Split text into words and filter out combined noise and stop words
  const words = cleanedText.split(" ");
  const filteredWords = words.filter(
    (word) => !combinedWords.has(word.toLowerCase())
  );
  cleanedText = filteredWords.join(" ");

  // Extract meta tags
  const metaDescription = $("meta[name='description']").attr("content") || "";
  const metaTitle = $("title").text() || "";
  const canonicalLink = $("link[rel='canonical']").attr("href") || "";
  const canonical = canonicalLink ? new URL(canonicalLink, url).href : "";

  // Extract URLs
  const baseUrl = new URL(url).origin;
  const urls = [];
  $("a[href]").each((index, element) => {
    const href = $(element).attr("href");
    if (href) {
      try {
        const parsedUrl = new URL(href, url); // Use base URL context
        if (
          parsedUrl.origin === baseUrl &&
          !excludedExtensions.test(parsedUrl.pathname)
        ) {
          // Check if it belongs to the same origin and does not match excluded extensions
          urls.push(parsedUrl.href);
        }
      } catch (e) {
        // Invalid URL, skip it
      }
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
    const { body } = await gotScraping.get(url);
    const result = extractTextFromHTML(body, url);
    res.json(result);
  } catch (err) {
    console.error("Error fetching the URL: ", err);
    res.status(500).json({ error: "Error fetching the URL" });
  }
});

export default app;
