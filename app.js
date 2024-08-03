import express from "express";
import { pinoHttp, logger } from "./utils/logging.js";
import { gotScraping } from "got-scraping";
import cheerio from "cheerio";
import TurndownService from "turndown";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const app = express();

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
  const $ = cheerio.load(html);
  const baseUrl = new URL(url).origin;

  // Remove unwanted elements
  $(
    'style, script, noscript, iframe, object, embed, [hidden], [style*="display:none"], [aria-hidden="true"], header, footer, nav, aside, .ads, .banner, .cookie-notice, .social-share'
  ).remove();

  // Extract main content using Readability
  const dom = new JSDOM($.html());
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  // Convert HTML to Markdown
  const turndownService = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  turndownService.addRule("removeEmptyParagraphs", {
    filter: "p",
    replacement: (content) => (content.trim() ? `\n\n${content}\n\n` : ""),
  });
  const markdown = turndownService.turndown(
    article ? article.content : $("body").html()
  );

  // Clean up the markdown
  const cleanedMarkdown = markdown
    .replace(/\n{3,}/g, "\n\n") // Remove excess newlines
    .replace(/^\s+|\s+$/g, "") // Trim leading/trailing whitespace
    .replace(/\[(?:\s*)\]/g, ""); // Remove empty links

  // Original text cleaning process
  let cleanedText = $("body")
    .text()
    .trim()
    .replace(/\s\s+/g, " ")
    .replace(/\n/g, " ")
    .trim();
  const combinedWords = new Set([...noiseWords, ...stopWords]);
  const words = cleanedText.split(" ");
  const filteredWords = words.filter(
    (word) => !combinedWords.has(word.toLowerCase())
  );
  cleanedText = filteredWords.join(" ");

  const metaDescription = $("meta[name='description']").attr("content") || "";
  const metaTitle = $("title").text() || "";
  const canonicalLink = $("link[rel='canonical']").attr("href") || "";
  const canonical = canonicalLink ? new URL(canonicalLink, url).href : "";

  const urls = [];
  $("a[href]").each((index, element) => {
    const href = $(element).attr("href");
    if (href) {
      try {
        const parsedUrl = new URL(href, url);
        if (
          parsedUrl.origin === baseUrl &&
          !excludedExtensions.test(parsedUrl.pathname)
        ) {
          urls.push(parsedUrl.href);
        }
      } catch (e) {
        // Invalid URL, skip it
      }
    }
  });

  // Extract keywords
  const keywords = extractKeywords(cleanedMarkdown);

  return {
    html,
    text: cleanedText,
    metaDescription,
    metaTitle,
    url,
    canonical,
    canonicalLink,
    urls,
    markdown: cleanedMarkdown,
    keywords,
  };
};

const extractKeywords = (text) => {
  const words = text.toLowerCase().match(/\b\w+\b/g) || [];
  const wordFreq = {};
  words.forEach((word) => {
    if (word.length > 2) {
      // Ignore short words
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }
  });
  return Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map((entry) => entry[0]);
};

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
