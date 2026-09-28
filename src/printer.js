import fs from "node:fs";
import { spawn } from "node:child_process";
import { createCanvas } from "canvas";

const DEVICE_URI = "usb://TSC/TE300?serial=000001";
const FILE = "/tmp/tsc-bitmap.prn";

// 30 × 10 mm at 300 DPI
const WIDTH = 344;
const HEIGHT = 118;

const TEXT_OFFSET_X = -10;


// ======================================================
// RENDER LABEL
// ======================================================

function renderLabel(name) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // White background
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Empty label
  if (!name) {
    return canvas;
  }

  const maxWidth = WIDTH - 40;

  const maxFontSize = 90;
  const minOneLineFontSize = 45;

  // ---------- TRY ONE LINE FIRST ----------

  let fontSize = maxFontSize;

  while (fontSize > minOneLineFontSize) {
    ctx.font = `bold ${fontSize}px Arial`;

    if (ctx.measureText(name).width <= maxWidth) {
      break;
    }

    fontSize--;
  }

  ctx.fillStyle = "black";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Fits on one line
  if (ctx.measureText(name).width <= maxWidth) {
    ctx.font = `bold ${fontSize}px Arial`;

    ctx.fillText(
      name,
      WIDTH / 2 + TEXT_OFFSET_X,
      HEIGHT / 2
    );

    console.log(`"${name}" → one line, ${fontSize}px`);

    return canvas;
  }


  // ---------- TWO LINES ----------

  const words = name.split(" ");

  let bestLine1 = "";
  let bestLine2 = "";
  let bestDifference = Infinity;

  // Try every possible word split
  for (let i = 1; i < words.length; i++) {
    const line1 = words.slice(0, i).join(" ");
    const line2 = words.slice(i).join(" ");

    ctx.font = "bold 40px Arial";

    const width1 = ctx.measureText(line1).width;
    const width2 = ctx.measureText(line2).width;

    const difference = Math.abs(width1 - width2);

    if (difference < bestDifference) {
      bestDifference = difference;
      bestLine1 = line1;
      bestLine2 = line2;
    }
  }

  // Find largest font where BOTH lines fit
  fontSize = 50;

  while (fontSize > 20) {
    ctx.font = `bold ${fontSize}px Arial`;

    const line1Width = ctx.measureText(bestLine1).width;
    const line2Width = ctx.measureText(bestLine2).width;

    if (
      line1Width <= maxWidth &&
      line2Width <= maxWidth
    ) {
      break;
    }

    fontSize--;
  }

  ctx.font = `bold ${fontSize}px Arial`;

  const lineGap = fontSize * 0.9;

  ctx.fillText(
    bestLine1,
    WIDTH / 2 + TEXT_OFFSET_X,
    HEIGHT / 2 - lineGap / 2
  );

  ctx.fillText(
    bestLine2,
    WIDTH / 2 + TEXT_OFFSET_X,
    HEIGHT / 2 + lineGap / 2
  );

  console.log(
    `"${name}" → two lines: "${bestLine1}" / "${bestLine2}", ${fontSize}px`
  );

  return canvas;
}


// ======================================================
// CANVAS → TSPL BITMAP
// ======================================================

function canvasToBitmap(canvas) {
  const ctx = canvas.getContext("2d");

  const image = ctx.getImageData(
    0,
    0,
    WIDTH,
    HEIGHT
  );

  // TSPL wants width in BYTES, not pixels
  const widthBytes = Math.ceil(WIDTH / 8);

  const bitmap = Buffer.alloc(
    widthBytes * HEIGHT,
    0xff
  );

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {

      const pixelIndex =
        (y * WIDTH + x) * 4;

      const r = image.data[pixelIndex];
      const g = image.data[pixelIndex + 1];
      const b = image.data[pixelIndex + 2];

      const brightness =
        (r + g + b) / 3;

      // Dark pixel → print dot
      if (brightness < 128) {

        const byteIndex =
          y * widthBytes +
          Math.floor(x / 8);

        const bit =
          7 - (x % 8);

        bitmap[byteIndex] &=
          ~(1 << bit);
      }
    }
  }

  return {
    bitmap,
    widthBytes
  };
}


// ======================================================
// CREATE DATA FOR ONE PRODUCT
// ======================================================

function createPrintData(product) {
  const canvas = renderLabel(product.name);

  const {
    bitmap,
    widthBytes
  } = canvasToBitmap(canvas);

  console.log(
    `Preparing ${product.quantity} × "${product.name || "[EMPTY LABEL]"}"`
  );

  return Buffer.concat([
    Buffer.from(
      [
        "SIZE 30 mm,10 mm",
        "GAP 2 mm,0 mm",
        "SPEED 3",
        "DENSITY 8",
        "DIRECTION 1",
        "CLS"
      ].join("\r\n") + "\r\n",
      "ascii"
    ),

    Buffer.from(
      `BITMAP 0,0,${widthBytes},${HEIGHT},0,\r\n`,
      "ascii"
    ),

    bitmap,

    Buffer.from(
      `\r\nPRINT ${product.quantity},1\r\n`,
      "ascii"
    )
  ]);
}


// ======================================================
// CREATE ONE LARGE JOB FROM MULTIPLE LABELS
// ======================================================

function createPrintDataGroup(products) {
  return Buffer.concat(
    products.map(product =>
      createPrintData(product)
    )
  );
}


// ======================================================
// SEND DATA TO PRINTER
// ======================================================

function sendToPrinter(data, jobName) {
  return new Promise((resolve, reject) => {

    fs.writeFileSync(FILE, data);

    const printer = spawn(
      "/usr/libexec/cups/backend/usb",
      [
        "1",
        process.env.USER || "user",
        jobName,
        "1",
        "",
        FILE
      ],
      {
        env: {
          ...process.env,
          DEVICE_URI
        }
      }
    );

    let sentSuccessfully = false;
    let stderr = "";

    printer.stderr.on("data", data => {
      const message = data.toString();

      stderr += message;

      console.log(message);

      if (stderr.includes("Sent ")) {
        sentSuccessfully = true;
      }
    });

    printer.on("error", error => {
      reject(error);
    });

    printer.on("close", code => {

      if (sentSuccessfully) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Printer stopped before sending job "${jobName}". Code: ${code}`
        )
      );
    });

    // CUPS USB backend normally waits after sending.
    // Stop it after 10 seconds.
    setTimeout(() => {

      if (!printer.killed) {
        printer.kill();
      }

    }, 10000);
  });
}


// ======================================================
// PRINT ONE REGULAR PERFUME
// ======================================================

async function printSingleProduct(product) {
  const data = createPrintData(product);

  await sendToPrinter(
    data,
    `Product Labels - ${product.name}`
  );
}


// ======================================================
// PRINT WHOLE UNIQUE GROUP IN ONE USB JOB
// ======================================================

async function printProductGroup(products) {
  const data = createPrintDataGroup(products);

  await sendToPrinter(
    data,
    "Unique Product Labels"
  );
}


// ======================================================
// MAIN PRINT WORKFLOW
// ======================================================

async function printProducts(products) {

  let i = 0;

  while (i < products.length) {

    const product = products[i];


    // --------------------------------------------------
    // REGULAR PERFUME
    // --------------------------------------------------

    if (product.name !== "") {

      console.log(
        `\nPRINTING ${i + 1}/${products.length}: ` +
        `"${product.name}" ×${product.quantity}`
      );

      await printSingleProduct(product);

      console.log(
        `✓ SENT: "${product.name}" ×${product.quantity}`
      );

      i++;

      continue;
    }


    // --------------------------------------------------
    // UNIQUE PERFUME GROUP
    // --------------------------------------------------
    //
    // Blank label means:
    //
    // blank
    // ОДИНОЧНЫЕ 3 МЛ
    // perfume
    // perfume
    // perfume
    // blank
    //
    // Everything until the next blank is sent
    // through ONE USB connection.
    // --------------------------------------------------

    const group = [product];

    i++;

    while (
      i < products.length &&
      products[i].name !== ""
    ) {
      group.push(products[i]);
      i++;
    }


    // If this is only the final blank label,
    // print it normally.
    if (group.length === 1) {

      console.log(
        "\nPRINTING FINAL EMPTY LABEL"
      );

      await printSingleProduct(group[0]);

      console.log(
        "✓ SENT FINAL EMPTY LABEL"
      );

      continue;
    }


    console.log(
      `\nPRINTING UNIQUE GROUP: ` +
      `${group.length} labels in ONE USB job`
    );

    await printProductGroup(group);

    console.log(
      `✓ SENT UNIQUE GROUP: ${group.length} labels`
    );
  }


  console.log(
    "\n✓ ALL LABELS PRINTED"
  );
}


// ======================================================
// EXPORT
// ======================================================

export {
  printProducts
};