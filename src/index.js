require('dotenv').config();
const Parser = require("rss-parser");
const fetch = require("node-fetch");
const nodemailer = require("nodemailer");
const handlebars = require("handlebars");

// Konstanta URL
const RSS_URL = "https://sabdaliterasi.xyz/rss-mail.xml";
const SUBSCRIBER_URL = "https://subscribesabda-default-rtdb.firebaseio.com/subscribers.json";
const LAST_SENT_URL = "https://ajax-jquery.github.io/subscriber/lastSentArticle.json";
const TEMPLATE_URL = "https://sabdaliterasi.xyz/templatemail.html";

// Konfigurasi nodemailer
const transporter = nodemailer.createTransport({
  service: process.env.SERVICE,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Fungsi utilitas
async function fetchJSON(url) {
  const response = await fetch(url);
  return await response.json();
}

async function fetchTemplate(url) {
  const response = await fetch(url);
  return await response.text();
}

async function updateFileOnGitHub(content) {
  const repo = process.env.GITHUB_REPO;
  const filePath = process.env.GITHUB_FILE_PATH;
  const branch = process.env.GITHUB_BRANCH;
  const token = process.env.GITHUB_TOKEN;

  const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;

  // Ambil SHA file untuk pembaruan
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    console.error("Gagal mengambil file dari GitHub:", await response.text());
    throw new Error("Gagal mengambil file dari GitHub");
  }

  const fileData = await response.json();
  const sha = fileData.sha;

  // Encode content to Base64
  const encodedContent = Buffer.from(JSON.stringify(content, null, 2)).toString("base64");

  // Perbarui file
  const updateResponse = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: "Update lastSentArticle.json via script",
      content: encodedContent,
      sha: sha,
      branch: branch,
    }),
  });

  if (!updateResponse.ok) {
    console.error("Gagal memperbarui file di GitHub:", await updateResponse.text());
    throw new Error("Gagal memperbarui file di GitHub");
  }

  console.log("File lastSentArticle.json berhasil diperbarui di GitHub.");
}

// Fungsi utama
async function main() {
  const parser = new Parser({
    customFields: {
      item: [
        ['media:thumbnail', 'thumbnail'],
        ['media:content', 'contentMedia'],
        ['content:encoded', 'fullContent']
      ]
    }
  });

  // 1. Ambil RSS feed
  const feed = await parser.parseURL(RSS_URL);

  // 2. Ambil data subscriber dari Firebase Realtime Database
  const subscriberData = await fetchJSON(SUBSCRIBER_URL);
  const subscribers = Object.values(subscriberData); // Mengonversi objek ke array

  // 3. Ambil last sent article
  const lastSentData = await fetchJSON(LAST_SENT_URL);
  const sentLinks = new Set(lastSentData.links);

  // 4. Ambil artikel baru yang belum dikirim
  const newArticles = feed.items.filter((item) => !sentLinks.has(item.link));
  if (newArticles.length === 0) {
    console.log("Tidak ada artikel baru.");
    return;
  }

  // 5. Ambil template email
  const templateHTML = await fetchTemplate(TEMPLATE_URL);
  const compiledTemplate = handlebars.compile(templateHTML);

  // 6. Kirim email untuk setiap subscriber
  for (const subscriber of subscribers) {
    for (const article of newArticles) {
      const emailContent = compiledTemplate({
        title: article.title,
        Thumbnail: article.thumbnail ? article.thumbnail.$.url : "",
        link: article.link,
        fullContent: article.fullContent
      });

      const mailOptions = {
        from: `New Articles Sabda Literasi <newarticles@sabdaliterasi.xyz>`,
        to: subscriber.email,
        subject: `Artikel Baru: ${article.title}`,
        html: emailContent,
      };

      try {
        await transporter.sendMail(mailOptions);
        console.log(`Email berhasil dikirim ke ${subscriber.email}`);
      } catch (err) {
        console.error(`Gagal mengirim email ke ${subscriber.email}:`, err);
      }
    }
  }

  // 7. Perbarui last sent article
  const updatedLinks = [...sentLinks, ...newArticles.map((item) => item.link)];
  const updatedLastSent = { links: updatedLinks };

  try {
    await updateFileOnGitHub(updatedLastSent);
    console.log("File lastSentArticle.json berhasil diperbarui di GitHub.");
  } catch (err) {
    console.error("Gagal memperbarui file di GitHub:", err);
  }
}

// Jalankan fungsi utama
main().catch((err) => console.error(err));
