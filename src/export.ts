import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import { stringify } from "csv-stringify/sync";
import { writeFileSync } from "fs";

const storage = createStorage({
  driver: fsDriver({ base: "./data" }),
});

export async function exportProducts() {
    const filename = `export-${Date.now().toString()}.csv`
    const keys = await storage.getKeys("processed-product");
    const data = (await storage.getItems(keys)).map((item) => {
      const val = item.value as any;
      if (!val) {
        return null;
      }

      return {
        url: val.url,
        title: val.title,
        image: val.image,
        originalPrice: val.originalPrice,
        discountPrice: val.discountPrice,
        discountPercentage: val.discountPercentage,
        sellerLocation: val.sellerLocation,
        sellerName: val.sellerName,
        feedbackPositive: val.feedbackPositive,
        feedbackTotal: val.feedbackTotal,
        productInfo: val.productInfo,
        condition: val.condition,
        processTime: val.processTime,
        description: val.description,
      };
    }).filter((n) => n && !!n.title && !!n.image);
    console.info(`${data.length} produk ditemukan !`)

    console.info('Mengexport ke file CSV ...')
    const csv = stringify(data, { header: true, quoted: true });
    writeFileSync( filename, csv, { flag: "w+" });
    console.info(`Export berhasil disimpan dengan nama ${filename}.csv`);
}