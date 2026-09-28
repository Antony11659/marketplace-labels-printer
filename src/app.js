import { printProducts } from "./printer.js";

const products = [
  { name: "Hundred Silent Ways", quantity: 1 },
  { name: "Playing With The Devil", quantity: 1 },
  { name: "Gaba", quantity: 1 },
];


try {
    await printProducts(products);
    console.log("Print job completed successfully.");
  } catch (error) {
    console.error("Print failed:", error);
  }