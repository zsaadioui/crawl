import express from "express";
import { pinoHttp, logger } from "./utils/logging.js";
import { gotScraping } from "got-scraping";
import TurndownService from "turndown";
import { JSDOM } from "jsdom";

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
]);

const excludedExtensions =
  /\.(js|css|png|jpe?g|gif|wmv|mp3|mp4|wav|pdf|docx?|xls|zip|rar|exe|dll|bin|pptx?|potx?|wmf|rtf|webp|webm)$/i;

const extractTextFromHTML = (html, url) => {
  // Create a JSDOM instance to manipulate the HTML
  const dom = new JSDOM(html);
  const document = dom.window.document;

  // Remove unnecessary elements
  const elementsToRemove = document.querySelectorAll(
    "header, aside, nav, footer, .ads, .comments"
  );
  elementsToRemove.forEach((el) => el.remove());

  // Extract only the main content (adjust selector as needed)
  const mainContent =
    document.querySelector("main") ||
    document.querySelector("article") ||
    document.body;

  // Convert the cleaned HTML to Markdown
  const markdown = turndownService.turndown(mainContent.innerHTML);

  // Extract URLs
  const baseUrl = new URL(url).origin;
  const urls = Array.from(document.querySelectorAll("a[href]"))
    .map((a) => {
      try {
        const href = a.getAttribute("href");
        const parsedUrl = new URL(href, url);
        if (
          parsedUrl.origin === baseUrl &&
          !excludedExtensions.test(parsedUrl.pathname)
        ) {
          return parsedUrl.href;
        }
      } catch (e) {
        // Invalid URL, skip it
      }
      return null;
    })
    .filter(Boolean);

  return { url, markdown, urls };
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
