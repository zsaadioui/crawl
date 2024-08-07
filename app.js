import express from "express";
import { pinoHttp, logger } from "./utils/logging.js";
import { gotScraping } from "got-scraping";
import TurndownService from "turndown";
import { JSDOM } from "jsdom";
import getHrefs from "get-hrefs";
import { removeStopwords, eng as englishStopwords } from "stopword";
import CacheableLookup from "cacheable-lookup";

const app = express();

// Use request-based logger for log correlation
app.use(pinoHttp);

// Add this line to parse JSON request bodies
app.use(express.json());

const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

// Configure Turndown to remove unwanted elements
turndownService.remove([
  "script",
  "style",
  "nav",
  "footer",
  "iframe",
  "noscript",
  "object",
  "embed",
  "[hidden]",
  "[style=display:none]",
  "[aria-hidden=true]",
]);

const excludedExtensions =
  /\.(js|css|png|jpe?g|gif|wmv|mp3|mp4|wav|pdf|docx?|xls|zip|rar|exe|dll|bin|pptx?|potx?|wmf|rtf|webp|webm)$/i;

// Optimize Got Scraping
const cacheable = new CacheableLookup();

const optimizedGotScraping = gotScraping.extend({
  timeout: {
    request: 30000, // Increase to 10 seconds
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
  // Create a JSDOM instance to manipulate the HTML
  const dom = new JSDOM(html);
  const document = dom.window.document;

  // Remove unnecessary elements
  const elementsToRemove = document.querySelectorAll(
    "header, aside, nav, footer, .ads, .comments, script, style, iframe, noscript, " +
      "button, input, form, .social-media, .share-buttons, .related-posts, .sidebar, " +
      ".menu, .navigation, .author-info, .metadata, .tags, .categories, .pagination, " +
      ".cookie-notice, .newsletter-signup, .popup, .modal, .banner, .advertisement, " +
      "[hidden], [style='display:none'], [aria-hidden='true']"
  );
  elementsToRemove.forEach((el) => el.remove());

  // Extract the content
  const content = document.documentElement.outerHTML;

  // Convert the HTML to Markdown
  const markdown = turndownService.turndown(content);

  // Replace multiple spaces and newlines with a single space
  let cleanedMarkdown = markdown
    .replace(/\s\s+/g, " ")
    .replace(/\n/g, " ")
    .trim();

  // Remove stopwords
  const wordsArray = cleanedMarkdown.split(/\s+/);
  const cleanWordsArray = removeStopwords(wordsArray, englishStopwords);
  cleanedMarkdown = cleanWordsArray.join(" ");

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

  return { url, markdown: cleanedMarkdown, urls };
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

    const response = await optimizedGotScraping.get(url, {
      responseType: "text",
      throwHttpErrors: false, // This allows us to handle 404 errors
    });

    if (response.statusCode === 404) {
      logger.info({ url }, "404 Not Found");
      return res.status(404).json({ error: "Page not found" });
    }

    if (!response.ok) {
      logger.error({ url, statusCode: response.statusCode }, "HTTP error");
      return res
        .status(response.statusCode)
        .json({ error: `HTTP error: ${response.statusCode}` });
    }

    const body = response.body;
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
    res.status(500).json({ error: "Error fetching the URL" });
  }
});

export default app;
