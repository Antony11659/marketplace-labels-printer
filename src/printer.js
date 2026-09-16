import fs from "node:fs";
import { spawn } from "node:child_process";
import { createCanvas } from "canvas";

const DEVICE_URI = "usb://TSC/TE300?serial=000001";
const FILE = "/tmp/tsc-bitmap.prn";
// 30 × 10 mm at 300 DPI
const WIDTH = 344;
const HEIGHT = 118;

function renderLabel(name) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

// White background
ctx.fillStyle = "white";
ctx.fillRect(0, 0, WIDTH, HEIGHT);


// Keep text farther away from the edges
const maxWidth = WIDTH - 80;

  // Find largest font that fits
  let fontSize = 90;

  while (fontSize > 10) {
    ctx.font = `bold ${fontSize}px Arial`;

    if (ctx.measureText(name).width <= maxWidth) {
      break;
    }

    fontSize--;
  }

  // Draw centered text
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.fillStyle = "black";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillText(
    name,
    WIDTH / 2,
    HEIGHT / 2
  );

  console.log(`Text: "${name}"`);
  console.log(`Font size: ${fontSize}px`);
  console.log(`Width: ${ctx.measureText(name).width}px`);

  return canvas;
}

function canvasToBitmap(canvas) {
  const ctx = canvas.getContext("2d");

  const image = ctx.getImageData(
    0,
    0,
    WIDTH,
    HEIGHT
  );

  // TSPL wants width in BYTES, not pixels.
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

function createPrintData(products) {
    const parts = [
      Buffer.from(
        [
          "SIZE 30 mm,10 mm",
          "GAP 2 mm,0 mm",
          "SPEED 3",
          "DENSITY 8",
          "DIRECTION 1"
        ].join("\r\n") + "\r\n",
        "ascii"
      )
    ];
  
    for (const product of products) {
      const canvas = renderLabel(product.name);
  
      const {
        bitmap,
        widthBytes
      } = canvasToBitmap(canvas);
  
      console.log(
        `Preparing ${product.quantity} × "${product.name}"`
      );
  
      parts.push(
        Buffer.from(
          `CLS\r\nBITMAP 0,0,${widthBytes},${HEIGHT},0,\r\n`,
          "ascii"
        ),
  
        bitmap,
  
        Buffer.from(
          `\r\nPRINT ${product.quantity},1\r\n`,
          "ascii"
        )
      );
    }
  
    return Buffer.concat(parts);
  }

function printProducts(products) {

  const data = createPrintData(products);

  fs.writeFileSync(FILE, data);

  console.log(
    `Sending ${data.length} bytes to TE300...`
  );

  const printer = spawn(
    "/usr/libexec/cups/backend/usb",
    [
      "1",
      process.env.USER || "user",
      "Bitmap Label",
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

  printer.stderr.on(
    "data",
    data => {
      console.log(
        data.toString()
      );
    }
  );

  printer.on(
    "close",
    code => {
      console.log(
        "Printer finished:",
        code
      );
    }
  );

  // Same workaround as before:
  // USB backend waits for printer status.
  setTimeout(() => {
    if (!printer.killed) {
      printer.kill();
    }
  }, 5000);
}

export {
  printProducts
};