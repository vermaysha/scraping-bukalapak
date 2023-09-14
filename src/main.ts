import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import { Cluster } from "puppeteer-cluster";
import { createHash } from "crypto";
import { cpus } from "os";
import type { Page } from "puppeteer";

const storage = createStorage({
  driver: fsDriver({ base: "./data" }),
});
const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

async function scrapeProduct({ page, data }: { page: Page; data: string }) {
  const url = new URL(data);
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setRequestInterception(true);
  page.setDefaultNavigationTimeout(0);

  page.on("request", (req) => {
    if (
      // req.resourceType() == "stylesheet" ||
      req.resourceType() == "font"
      // req.resourceType() == "image"
    ) {
      req.abort();
    } else {
      req.continue();
    }
  });

  await page.goto(url.toString(), { waitUntil: "networkidle2" });

  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 500);
    });
  });

  try {
    await page.waitForSelector("h1", {
      timeout: 60_000,
    });
  } catch (error) {
    await storage.removeItem(`queue-product/${sha1(data)}`, {
      removeMeta: true
    });
    throw new Error((error as any).message ?? '');
  }

  const result = await page.evaluate(() => {
    const title = document.querySelector("h1")?.textContent?.trim();
    const originalPrice = document
      .querySelector(".c-main-product__price > .c-product-price")
      ?.textContent?.trim();
    const discountPrice = document
      .querySelector(".c-main-product__price__discount > .c-product-price")
      ?.textContent?.trim();
    const discountPercentage = document
      .querySelector(".c-main-product__price__discount-percentage")
      ?.textContent?.trim();
    const sellerLocation =
      document
        .querySelector(
          ".c-delivery-location__seller .c-delivery-location__name"
        )
        ?.textContent?.trim() ??
      document.querySelector(".c-seller__city")?.textContent?.trim();
    const sellerName = document
      .querySelector(".c-seller__name")
      ?.textContent?.trim();
    const feedbackPositive = document
      .querySelector(".c-seller__meta__feedback-url")
      ?.textContent?.trim()
      .replace(" Feedback Positif", "");
    const feedbackTotal = document
      .querySelector(".c-seller__meta__feedback-total")
      ?.textContent?.trim()
      .replace("dari", "")
      .replace("feedback", "")
      .replace(" ", "");
    const productInfo = document
      .querySelector(".c-main-product__information span")
      ?.textContent?.trim();
    const condition = [...document.querySelectorAll(".c-information__subtitle")]
      .find((el) => el.innerHTML === "Kondisi Barang")
      ?.nextSibling?.textContent?.trim();

    const processTime = document
      .querySelector(".c-seller__meta__pesanan h3")
      ?.textContent?.trim();
    const description = document
      .querySelector(".c-information__description-txt")
      ?.innerHTML.replace(/<\/?[^>]+(>|$)/g, "\n")
      .replace(/\n+/g, "\n");
    const image = (
      document
        .querySelector(
          ".c-product-gallery__main-image source[type='image/jpeg']"
        )
        ?.getAttribute("srcset") ??
      document
        .querySelector(".c-product-gallery__main-image img")
        ?.getAttribute("src")
    )?.replace("small", "large");

    return {
      url: window.location.toString(),
      title,
      image,
      originalPrice,
      discountPrice,
      discountPercentage,
      sellerLocation,
      sellerName,
      feedbackPositive,
      feedbackTotal,
      productInfo,
      condition,
      processTime,
      description,
    };
  });

  await storage.setItem(
    `processed-product/${sha1(data)}`,
    JSON.stringify(result)
  );
  await storage.removeItem(`queue-product/${sha1(data)}`, {
    removeMeta: true
  });
}

async function scrapeShop({ page, data }: { page: Page; data: string }) {
  const url = new URL(data);
  const key = `queue-shop/${sha1(data)}`
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setRequestInterception(true);
  page.setDefaultNavigationTimeout(0);

  page.on("request", (req) => {
    if (
      // req.resourceType() == "stylesheet" ||
      req.resourceType() == "font"
      // req.resourceType() == "image"
    ) {
      req.abort();
    } else {
      req.continue();
    }
  });

  if ((await storage.getMeta(key)).lastPage) {
    return;
  }

  let pageSize = Number((await storage.getMeta(key)).lastPage || '1');
  let maxPageSize = 1;
  do {
    url.searchParams.set("page", pageSize.toString());
    await page.goto(url.toString(), { waitUntil: "networkidle2" });

    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight - window.innerHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 500);
      });
    });

    const products = await page.evaluate(() => {
      const pages = document
        .querySelector("#merchant-page-product-list")
        ?.querySelectorAll(".item-product");

      if (pages) {
        const results: string[] = [];
        [...pages].forEach((el) => {
          const link = el.querySelector("a")?.getAttribute("href");
          if (!link) {
            return;
          }

          results.push(link);
        });

        return results;
      }

      return [];
    });

    await storage.setItems(
      products.map((link) => {
        return {
          key: `queue-product/${sha1(link)}`,
          value: link,
        };
      })
    );

    maxPageSize = await page.evaluate(() => {
      return Number(
        [
          ...document.querySelectorAll(
            ".c-ghostblock-pagination .c-ghostblock-pagination__main .c-ghostblock-pagination__list .c-ghostblock-pagination__link"
          ),
        ].at(-1)?.textContent || "1"
      );
    });

    pageSize++;
    await storage.setMeta(key, { lastPage: pageSize });
  } while (pageSize < maxPageSize);

  await storage.removeItem(key, {
    removeMeta: true,
  })
}

async function main() {
  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_CONTEXT,
    maxConcurrency: cpus().length * 2,
    // maxConcurrency: 1,
    monitor: true,
    puppeteerOptions: {
      headless: "new",
      // headless: false,
      timeout: 0,
    },
    timeout: 3_600_000, //1 hours
  });

  for (let i = 1; i <= 99; i++) {
    // skip scrapped main page
    if (await storage.getItem(`processed-main-page/${i}`)) {
      continue;
    }

    // Scrape main page
    cluster.queue(`Scrape Bukalapak halaman ${i}`, async ({ page }) => {
      const url = new URL(
        "https://www.bukalapak.com/products?search%5Bbrand%5D=1&search%5Bsort_by%5D=last_relist_at%3Adesc"
      );
      url.searchParams.set("page", i.toString());
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setRequestInterception(true);
      page.setDefaultNavigationTimeout(0);

      page.on("request", (req) => {
        if (
          // req.resourceType() == "stylesheet" ||
          req.resourceType() == "font" ||
          req.resourceType() == "image"
        ) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(url.toString(), { waitUntil: "networkidle2" });

      await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
          let totalHeight = 0;
          const distance = 100;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;

            if (totalHeight >= scrollHeight - window.innerHeight) {
              clearInterval(timer);
              resolve();
            }
          }, 500);
        });
      });

      try {
        await page.waitForSelector(".bl-product-card-new", {
          timeout: 60_000,
        });
      } catch (error) {
        // Silent is gold
        return;
      }

      const results = await page.evaluate(() => {
        const links: string[] = [];
        const shops: string[] = [];
        document.querySelectorAll(".bl-product-card-new").forEach((el) => {
          const link = el
            .querySelector(".bl-thumbnail a")
            ?.getAttribute("href");
          if (!link) {
            return null;
          }

          links.push(link);

          const shop = el
            .querySelector(".bl-product-card-new__store-name a")
            ?.getAttribute("href");
          if (!shop) {
            return null;
          }

          shops.push(shop);
        });

        return {
          products: links,
          shops,
        };
      });

      await storage.setItems(
        results.products.map((link) => {
          return {
            key: `queue-product/${sha1(link)}`,
            value: link,
          };
        })
      );

      await storage.setItems(
        results.shops.map((shop) => {
          return {
            key: `queue-shop/${sha1(shop)}`,
            value: shop,
          };
        })
      );

      await storage.setItem(`processed-main-page/${i}`, i);
    });
  }

  const totalProducts = await storage.getKeys("queue-product");
  if (totalProducts.length > 0) {
    const products = await storage.getItems(totalProducts);

    for (const product of products) {
      cluster.queue(product.value, scrapeProduct);
    }
  }

  const unwatch = storage.watch(async (event, key) => {
    if (event === 'update' && key.startsWith('queue-product')) {
      const data = (await storage.getItem(key))?.toString();
      cluster.queue(data, scrapeProduct)
    }

    if (event === 'update' && key.startsWith('queue-shop')) {
      const data = (await storage.getItem(key))?.toString();
      cluster.queue(data, scrapeShop)
    }
  })

  const totalShops = await storage.getKeys("queue-shop");
  if (totalShops.length > 0) {
    const shops = await storage.getItems(totalShops);

    for (const shop of shops) {
      cluster.queue(shop.value, scrapeShop);
    }
  }

  await cluster.idle();
  await cluster.close();
}

main();
