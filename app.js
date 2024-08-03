import express from "express";
import { pinoHttp, logger } from "./utils/logging.js";
import { gotScraping } from "got-scraping";
import cheerio from "cheerio";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import getHrefs from "get-hrefs";
import { removeStopwords, eng as englishStopwords } from "stopword";
import { convert } from "html-to-text";

const app = express();

// Use request-based logger for log correlation
app.use(pinoHttp);

// Add this line to parse JSON request bodies
app.use(express.json());

const excludedExtensions =
  /\.(js|css|png|jpe?g|gif|wmv|mp3|mp4|wav|pdf|docx?|xls|zip|rar|exe|dll|bin|pptx?|potx?|wmf|rtf|webp|webm)$/i;

const extractTextFromHTML = (html, url) => {
  // Use Readability to extract the article
  const dom = new JSDOM(html);
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  // Use Cheerio to clean up the HTML before converting to text
  const $ = cheerio.load(html);

  // Remove style, script, and other non-content elements
  $(
    "style, script, noscript, iframe, object, embed, [hidden], [style=display:none], [aria-hidden=true]"
  ).remove();

  // Get the cleaned HTML
  const cleanedHtml = $.html();

  // Convert cleaned HTML to text using html-to-text
  const options = {
    wordwrap: null, // Disable word wrapping
    preserveNewlines: true, // Keep original line breaks
    selectors: [
      { selector: "a", options: { ignoreHref: true } }, // Don't include link URLs in the text
      { selector: "img", format: "skip" }, // Skip images
    ],
  };

  let cleanedText = convert(cleanedHtml, options);

  // Replace multiple spaces and newlines with a single space
  cleanedText = cleanedText.replace(/\s\s+/g, " ").replace(/\n/g, " ").trim();

  // Remove stopwords
  const wordsArray = cleanedText.split(/\s+/);
  const cleanWordsArray = removeStopwords(wordsArray, englishStopwords);
  cleanedText = cleanWordsArray.join(" ");

  // Update the article object
  article.url = url;
  article.textContent = cleanedText;

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

  return article;
};

// Example endpoint
app.post("/", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

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
    res.json(result);
  } catch (err) {
    console.error("Error fetching the URL: ", err);
    res.status(500).json({ error: "Error fetching the URL" });
  }
});

export default app;
