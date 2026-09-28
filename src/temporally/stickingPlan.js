const volumeFields = {
    halfMl: 0.5,
    oneMl: 1,
    threeMl: 3,
    fiveMl: 5,
    tenMl: 10,
    twentyMl: 20,
    thirtyMl: 30,
    fiftyMl: 50,
  };
  
  
  export const createPrintList = (stickingPlan) => {
    const products = [];
  
    // 1. REGULAR PERFUMES
    for (const order of stickingPlan.regular) {
      products.push({
        name: order.name,
        quantity: order.total
      });
    }
  
  
    // 2. UNIQUE PERFUMES
    for (const [volume, names] of Object.entries(stickingPlan.unique)) {
  
      // Empty label BEFORE each unique group
      products.push({
        name: "",
        quantity: 1
      });
  
  
      // Separator label
      products.push({
        name: `ОДИНОЧНЫЕ ${volume} МЛ`,
        quantity: 1
      });
  
  
      // Unique perfume labels
      for (const name of names) {
        products.push({
          name,
          quantity: 1
        });
      }
    }
  
  
    // Final empty label AFTER all unique groups
    if (Object.keys(stickingPlan.unique).length > 0) {
      products.push({
        name: "",
        quantity: 1
      });
    }
  
  
    return products;
  };
  
  
  export const createStickingPlan = (orders) => {
    const regular = [];
    const unique = {};
  
  
    for (const order of orders) {
  
      // UNIQUE PERFUME
      // A perfume is unique ONLY when total count === 1
      if (order.count === 1) {
  
        for (const [field, volume] of Object.entries(volumeFields)) {
  
          if (order[field] === 1) {
  
            if (!unique[volume]) {
              unique[volume] = [];
            }
  
            unique[volume].push(order.name);
  
            break;
          }
        }
  
        continue;
      }
  
  
      // REGULAR PERFUME
      const bottles = [];
  
      for (const [field, volume] of Object.entries(volumeFields)) {
  
        if (order[field] > 0) {
          bottles.push({
            volume,
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