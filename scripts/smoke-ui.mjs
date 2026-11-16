export async function openAiOptions(page) {
  const review = page.locator(".ai-review");
  if (!(await review.evaluate((element) => element.open)))
    await review.locator(":scope > summary").click();
  await page.locator(".ai-options > summary").click();
}
export async function setting(page, query) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("searchbox", { name: "Find a setting" }).fill(query);
}
