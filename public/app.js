const printButton =
  document.querySelector("#printButton");

const status =
  document.querySelector("#status");

printButton.addEventListener("click", async () => {
  printButton.disabled = true;
  status.textContent = "Printing...";

  try {
    const response = await fetch("/api/print", {
      method: "POST"
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message);
    }

    status.textContent =
      "Labels printed successfully";
  } catch (error) {
    console.error(error);

    status.textContent =
      "Printing failed";
  } finally {
    printButton.disabled = false;
  }
});