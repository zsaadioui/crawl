import express from "express";
import { pinoHttp, logger } from "./utils/logging.js";
import { gotScraping } from "got-scraping";
import TurndownService from "turndown";
import { JSDOM } from "jsdom";
import getHrefs from "get-hrefs";
import { removeStopwords, eng as englishStopwords } from "stopword";
import CacheableLookup from "cacheable-lookup";
import axios from "axios";

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

// Add custom rule for handling links with absolute URLs
turndownService.addRule("absoluteLinks", {
  filter: "a",
  replacement: function (content, node, options) {
    let href = node.getAttribute("href") || "";
    try {
      // Get the base URL from the extractTextFromHTML function's url parameter
      const baseUrl = this.baseUrl; // This will be set when processing

      // Convert relative URL to absolute
      if (href && !href.startsWith("http") && !href.startsWith("mailto:")) {
        href = new URL(href, baseUrl).href;
      }

      return href ? `[${content}](${href})` : content;
    } catch (e) {
      return content;
    }
  },
});

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

async function fetchDataFromGoogle(
  query,
  maxChars,
  googleApiKey,
  googleSearchEngineId
) {
  try {
    // Fetch search results from Google
    const response = await axios.get(
      `https://www.googleapis.com/customsearch/v1?key=${googleApiKey}&cx=${googleSearchEngineId}&q=${encodeURIComponent(
        query
      )}&num=5`
    );

    const excludedPatterns =
      /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|rar|jpg|jpeg|png|gif|bmp|webp|svg)$/i;
    const suspectedNonTextPatterns = /viewcontent|download|serveFile|\.cgi/i;

    // Filter valid URLs
    const validUrls = response.data.items.filter(
      (item) =>
        !excludedPatterns.test(item.link) &&
        !suspectedNonTextPatterns.test(item.link)
    );

    // Fetch content from all valid URLs concurrently
    const results = await Promise.all(
      validUrls.map(async (item) => {
        try {
          const content = await fetchContentFromUrl(item.link);
          if (content && content.length > 100) {
            return {
              title: item.title,
              link: item.link,
              content: content,
            };
          }
        } catch (fetchError) {
          logger.error(
            { url: item.link, error: fetchError },
            "Error fetching content"
          );
          return null;
        }
      })
    );

    // Combine results while respecting maxChars
    let context = "";
    for (const result of results.filter(Boolean)) {
      const entry = `Title: ${result.title}\nSOURCE: ${result.link}\nContent: ${result.content}\n\n`;

      if (context.length + entry.length <= maxChars) {
        context += entry;
      } else {
        const remainingChars = maxChars - context.length;
        if (remainingChars > 0) {
          context += entry.slice(0, remainingChars);
        }
        break;
      }
    }

    return context;
  } catch (error) {
    logger.error({ error }, "Error fetching data from Google");
    return "";
  }
}

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

  // Set the base URL for the turndown service
  turndownService.baseUrl = url;

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

// Modify fetchContentFromUrl to include a timeout for individual requests
async function fetchContentFromUrl(url) {
  try {
    const response = await optimizedGotScraping.get(url, {
      responseType: "text",
      throwHttpErrors: false,
      timeout: {
        request: 10000, // Set request timeout to 10 seconds
      },
    });

    if (!response.ok) {
      logger.error(
        { url, statusCode: response.statusCode },
        "HTTP error when fetching content"
      );
      return "";
    }

    const body = response.body;
    return extractTextFromHTML(body, url).markdown;
  } catch (error) {
    // Skip URLs that time out or cause fetch errors
    if (error.name === "RequestError" || error.name === "TimeoutError") {
      logger.warn({ url, error: error.message }, "Skipping URL due to timeout");
      return ""; // Skip this URL if it times out
    }

    // Log other errors and continue
    logger.error(
      { url, error: error.message, stack: error.stack },
      "Error fetching content"
    );
    return "";
  }
}

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

// New endpoint for handling multiple search queries
app.post("/query", async (req, res) => {
  const {
    queries,
    googleApiKey,
    googleSearchEngineId,
    maxTotalChars = 200000,
  } = req.body;

  if (!queries || !Array.isArray(queries) || queries.length === 0) {
    return res.status(400).json({ error: "Valid queries array is required" });
  }

  if (!googleApiKey || !googleSearchEngineId) {
    return res
      .status(400)
      .json({ error: "Google API credentials are required" });
  }

  try {
    let contextData = "";
    const charsPerQuery = Math.floor(maxTotalChars / queries.length);

    for (const query of queries) {
      logger.info({ query }, "Fetching data for query");
      const queryContext = await fetchDataFromGoogle(
        query,
        charsPerQuery,
        googleApiKey,
        googleSearchEngineId
      );
      contextData += `**${query}:**\n${queryContext}\n-------------------------------------------------------------------------------\n\n\n`;
    }

    contextData = contextData.slice(0, maxTotalChars);
    logger.info(
      { contextLength: contextData.length },
      "Total context data length"
    );

    res.json({ contextData });
  } catch (err) {
    logger.error({ err }, "Error processing queries");
    res.status(500).json({ error: "Error processing queries" });
  }
});

export default app;
