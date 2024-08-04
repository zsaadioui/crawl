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
import { convert } from "html-to-text";
import getHrefs from "get-hrefs";
import { Transform } from "stream";
import { pipeline } from "stream/promises";

const app = express();

// Use request-based logger for log correlation
app.use(pinoHttp);
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
  const baseUrl = new URL(url).origin;

  console.log("4444 ", performance.now());
  // Convert cleaned HTML to text using html-to-text
  const options = {
    wordwrap: null, // Disable word wrapping
    preserveNewlines: true, // Keep original line breaks
    selectors: [
      { selector: "a", options: { ignoreHref: true } }, // Don't include link URLs in the text
      { selector: "img", format: "skip" }, // Skip images
    ],
  };

  let text = convert(html, options);

  console.log("55555 ", performance.now());

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

  console.log("66666 ", performance.now());

  const hrefs = getHrefs(html, { baseUrl });
  console.log("77777 ", performance.now());
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
  console.log("88888 ", performance.now());

  // Returning all the gathered data
  return {
    text: cleanedText,
    url,
    urls,
  };
};

// Example endpoint
app.post("/", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    logger.error("URL is required in the request body.");
    return res.status(400).json({ error: "URL is required" });
  }

  logger.info(`Received request to scrape URL: ${url}`);

  try {
    console.log("0000000000 ", performance.now());
    const responseStream = gotScraping.stream(url);

    let html = "";

    console.log("111111 ", performance.now());
    const transformStream = new Transform({
      transform(chunk, encoding, callback) {
        html += chunk.toString();
        callback();
      },
    });

    console.log("2222222 ", performance.now());

    await pipeline(responseStream, transformStream);

    console.log("3333333 ", performance.now());
    const result = extractTextFromHTML(html, url);

    logger.info(`Scraping successful for URL: ${url}`);
    res.json(result);
  } catch (err) {
    logger.error("Error fetching the URL", err);
    res.status(500).json({ error: "Error fetching the URL" });
  }
});

export default app;
