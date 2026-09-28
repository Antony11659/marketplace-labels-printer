import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";

import { printProducts } from "./printer.js";


const BACKEND_URL =
  "https://antony11659-perfumestorebackend-e001.twc1.net";


const volumeFields = {
  0.5: "halfMl",
  1: "oneMl",
  3: "threeMl",
  5: "fiveMl",
  10: "tenMl",
  20: "twentyMl",
  30: "thirtyMl",
  50: "fiftyMl"
};


// --------------------------------------------------
// LOAD PRODUCT DATA
// --------------------------------------------------

const productsData = JSON.parse(
  fs.readFileSync(
    new URL("../src/temporally/data.json", import.meta.url),
    "utf8"
  )
);


// --------------------------------------------------
// CREATE NEW OZON SESSION
// ONLY /api/print SHOULD USE THIS
// --------------------------------------------------

const createOzonSession = async () => {
  const response = await fetch(
    `${BACKEND_URL}/ozon/session`,
    {
      method: "POST"
    }
  );

  if (!response.ok) {
    const error = await response.text();

    throw new Error(
      `Failed to create Ozon session: ${response.status} ${error}`
    );
  }

  return response.json();
};


// --------------------------------------------------
// GET EXISTING OZON SESSION
// DOES NOT CREATE A NEW SESSION
// --------------------------------------------------

const getOzonSession = async () => {
  const response = await fetch(
    `${BACKEND_URL}/ozon/session`
  );

  if (!response.ok) {
    const error = await response.text();

    throw new Error(
      `Failed to get Ozon session: ${response.status} ${error}`
    );
  }

  return response.json();
};


// --------------------------------------------------
// GET ALL PRODUCTS FROM ALL SHOPS
// --------------------------------------------------

const getProductsFromSession = (session) => {
  const products = [];

  for (const shop of session.shops) {

    for (const order of shop.orders) {

      for (const product of order.products) {
        products.push(product);
      }

    }

  }

  return products;
};


// --------------------------------------------------
// AGGREGATE PRODUCTS
//
// RAW:
// SKU A → Gaba 3ml × 10
// SKU B → Gaba 5ml × 7
// SKU C → Gaba 3ml × 5
//
// RESULT:
// {
//   name: "Gaba",
//   count: 22,
//   threeMl: 15,
//   fiveMl: 7,
//   ...
// }
// --------------------------------------------------

const aggregateProducts = (products) => {
  const perfumes = new Map();
  const unknownProducts = new Map();


  for (const product of products) {

    const sku = String(product.sku);

    const quantity =
      Number(product.quantity);

    const productData =
      productsData[sku];


    // -------------------------
    // UNKNOWN SKU
    // -------------------------

    if (!productData) {

      if (!unknownProducts.has(sku)) {

        unknownProducts.set(sku, {
          sku,
          name: product.name ?? "Unknown",
          quantity: 0
        });

      }

      unknownProducts.get(sku).quantity +=
        quantity;

      continue;
    }


    const name = productData.name;

    const volume =
      Number(productData.volume);


    // -------------------------
    // CHECK VOLUME
    // -------------------------

    const volumeField =
      volumeFields[volume];


    if (!volumeField) {

      if (!unknownProducts.has(sku)) {

        unknownProducts.set(sku, {
          sku,
          name: product.name ?? name,
          quantity: 0,
          reason: `Unknown volume: ${volume}`
        });

      }

      unknownProducts.get(sku).quantity +=
        quantity;

      continue;
    }


    // -------------------------
    // CREATE PERFUME
    // -------------------------

    if (!perfumes.has(name)) {

      perfumes.set(name, {
        name,

        count: 0,

        halfMl: 0,
        oneMl: 0,
        threeMl: 0,
        fiveMl: 0,
        tenMl: 0,
        twentyMl: 0,
        thirtyMl: 0,
        fiftyMl: 0
      });

    }


    const perfume =
      perfumes.get(name);


    perfume.count += quantity;

    perfume[volumeField] += quantity;
  }


  // Convert Map → Array

  const orders =
    Array.from(perfumes.values());


  // IMPORTANT:
  // biggest perfume batch first

  orders.sort(
    (a, b) => b.count - a.count
  );


  return {
    orders,

    unknownProducts:
      Array.from(
        unknownProducts.values()
      )
  };
};


// --------------------------------------------------
// CREATE STICKING PLAN
//
// REGULAR:
// total > 1
//
// UNIQUE:
// total === 1
// grouped by volume
// --------------------------------------------------

const createStickingPlan = (orders) => {

  const regular = [];

  const unique = {};


  for (const order of orders) {


    // -------------------------
    // UNIQUE PERFUME
    // -------------------------

    if (order.count === 1) {

      for (
        const [volume, field]
        of Object.entries(volumeFields)
      ) {

        if (order[field] === 1) {

          if (!unique[volume]) {
            unique[volume] = [];
          }


          unique[volume].push(
            order.name
          );


          break;
        }

      }


      continue;
    }


    // -------------------------
    // REGULAR PERFUME
    // -------------------------

    const bottles = [];


    for (
      const [volume, field]
      of Object.entries(volumeFields)
    ) {

      if (order[field] > 0) {

        bottles.push({
          volume: Number(volume),
          quantity: order[field]
        });

      }

    }


    regular.push({
      name: order.name,
      bottles,
      total: order.count
    });
  }


  return {
    regular,
    unique
  };
};


// --------------------------------------------------
// CREATE PRINT LIST
//
// STICKING:
// Gaba
//   3ml ×15
//   5ml ×10
//   10ml ×10
//
// PRINT:
// Gaba ×35
// --------------------------------------------------

const createPrintList = (stickingPlan) => {

  const products = [];


  // -------------------------
  // REGULAR PERFUMES
  // -------------------------

  for (
    const order
    of stickingPlan.regular
  ) {

    products.push({
      name: order.name,
      quantity: order.total
    });

  }


  // -------------------------
  // UNIQUE PERFUMES
  // -------------------------

  for (
    const [volume, names]
    of Object.entries(
      stickingPlan.unique
    )
  ) {

    // Empty label before group

    products.push({
      name: "",
      quantity: 1
    });


    // Separator label

    products.push({
      name: `ОДИНОЧНЫЕ ${volume} МЛ`,
      quantity: 1
    });


    // Actual perfume labels

    for (const name of names) {

      products.push({
        name,
        quantity: 1
      });

    }

  }


  // Final empty label

  if (
    Object.keys(
      stickingPlan.unique
    ).length > 0
  ) {

    products.push({
      name: "",
      quantity: 1
    });

  }


  return products;
};


// --------------------------------------------------
// FASTIFY
// --------------------------------------------------

const fastify = Fastify({
  logger: true
});


await fastify.register(
  fastifyStatic,
  {
    root: new URL(
      "../public",
      import.meta.url
    )
  }
);


// --------------------------------------------------
// STATUS
// --------------------------------------------------

fastify.get(
  "/api/status",
  async () => {

    return {
      status: "ok"
    };

  }
);


// --------------------------------------------------
// STICKING
//
// IMPORTANT:
// READS EXISTING SESSION.
// NEVER CREATES A NEW SESSION.
// --------------------------------------------------

fastify.get(
  "/api/sticking",
  async (request, reply) => {

    try {

      const session =
        await getOzonSession();


      const products =
        getProductsFromSession(
          session
        );


      const {
        orders,
        unknownProducts
      } =
        aggregateProducts(
          products
        );


      const stickingPlan =
        createStickingPlan(
          orders
        );


      return {
        updatedAt:
          session.updated_at,

        regular:
          stickingPlan.regular,

        unique:
          stickingPlan.unique,

        unknownProducts
      };


    } catch (error) {

      console.error(
        "STICKING ERROR:",
        error
      );


      reply.code(500);


      return {
        success: false,
        error: error.message
      };

    }

  }
);


// --------------------------------------------------
// PRINT
//
// THIS IS THE ONLY ENDPOINT
// THAT CREATES A NEW OZON SESSION.
// --------------------------------------------------

fastify.post(
  "/api/print",
  async (request, reply) => {

    try {

      console.log(
        "Creating new Ozon session..."
      );


      // 1. CREATE NEW SESSION

      const session =
        await createOzonSession();


      console.log(
        "Ozon session created"
      );


      // 2. COLLECT ALL PRODUCTS

      const products =
        getProductsFromSession(
          session
        );


      console.log(
        `Product lines: ${products.length}`
      );


      // 3. AGGREGATE PERFUMES

      const {
        orders,
        unknownProducts
      } =
        aggregateProducts(
          products
        );


      console.log(
        `Known perfumes: ${orders.length}`
      );


      console.log(
        `Unknown products: ${unknownProducts.length}`
      );


      // 4. CREATE STICKING PLAN

      const stickingPlan =
        createStickingPlan(
          orders
        );


      // 5. CREATE PRINT LIST

      const printList =
        createPrintList(
          stickingPlan
        );


      console.log(
        "PRINTING:"
      );


      console.log(
        printList
      );


      // 6. PRINT LABELS

      await printProducts(
        printList
      );


      // 7. RETURN RESULT

      return {
        success: true,

        updatedAt:
          session.updated_at,

        printed:
          printList,

        unknownProducts
      };


    } catch (error) {

      console.error(
        "PRINT ERROR:",
        error
      );


      reply.code(500);


      return {
        success: false,
        error: error.message
      };

    }

  }
);


// --------------------------------------------------
// START SERVER
// --------------------------------------------------

try {

  await fastify.listen({
    port: 3000,
    host: "127.0.0.1"
  });


} catch (error) {

  fastify.log.error(error);

  process.exit(1);
}