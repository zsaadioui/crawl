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
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import getHrefs from "get-hrefs";
import { removeStopwords, eng as englishStopwords } from "stopword";

const app = express();

// Use request-based logger for log correlation
app.use(pinoHttp);

// Add this line to parse JSON request bodies
app.use(express.json());

const excludedExtensions =
  /\.(js|css|png|jpe?g|gif|wmv|mp3|mp4|wav|pdf|docx?|xls|zip|rar|exe|dll|bin|pptx?|potx?|wmf|rtf|webp|webm)$/i;

const extractTextFromHTML = (html, url) => {
  const dom = new JSDOM(html);
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  article.url = url;

  if (article && article.textContent) {
    const wordsArray = article.textContent.split(" ");
    const cleanWordsArray = removeStopwords(wordsArray, englishStopwords);
    article.textContent = cleanWordsArray.join(" ");
  }

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

  article.urls = urls;
  console.log(article);

  return article;
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
