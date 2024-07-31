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

const extractTextFromHTML = (html, url) => {
  const $ = cheerio.load(html);
  const baseUrl = new URL(url).origin;

  // Remove style, script, and other non-content elements
  $(
    "style, script, noscript, iframe, object, embed, [hidden], [style=display:none], [aria-hidden=true]"
  ).remove();

  // Extract text content from the body and trim leading/trailing whitespace
  const text = $("body").text().trim();

  // Combine both noiseWords and stopWords into one set for efficient lookup
  const combinedWords = new Set([...noiseWords, ...stopWords]);

  // Split text into words and filter out combined noise and stop words
  const words = text.split(" ");
  const filteredWords = words.filter(
    (word) => !combinedWords.has(word.toLowerCase())
  );
  const cleanedText = filteredWords.join(" ");

  // Extract meta tags
  const metaDescription = $("meta[name='description']").attr("content") || "";
  const metaTitle = $("title").text() || "";
  const canonicalLink = $("link[rel='canonical']").attr("href") || "";
  const canonical = canonicalLink ? new URL(canonicalLink, url).href : "";

  // Extract URLs
  const urls = [];
  $("a[href]").each((index, element) => {
    const href = $(element).attr("href");
    if (href) {
      try {
        const parsedUrl = new URL(href, url); // Use base URL context
        if (
          parsedUrl.origin === baseUrl &&
          !/(jpg|jpeg|png|gif|bmp|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|tar|gz)$/i.test(
            parsedUrl.pathname
          )
        ) {
          urls.push(parsedUrl.href);
        }
      } catch (e) {
        // Invalid URL, skip it
      }
    }
  });

  // Returning all the gathered data
  return {
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
