import { test, expect } from "@playwright/test";

/**
 * Middleware route protection.
 *
 * Runs WITHOUT the saved storage state — `storageState: undefined` overrides the
 * project default, so these requests arrive with no session cookie at all.
 *
 * What is asserted is deliberately modest, matching what middleware actually
 * does: it redirects before the client bundle loads and preserves where the
 * visitor was going. It is not an authorisation check — see docs/AUTH_NOTES.md.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test("unauthenticated /quiz does not serve the quiz page", async ({ page }) => {
  await page.goto("/quiz");

  // Either the middleware redirect or the client auth gate has taken over;
  // what must NOT happen is the quiz surface rendering.
  await expect(page.getByLabel("Your material")).toHaveCount(0);
  expect(page.url()).not.toContain("/quiz");
});

test("middleware redirects before the app renders and parks the destination", async ({
  page,
}) => {
  // `waitUntil: "commit"` so we observe the redirect itself rather than whatever
  // the client-side auth flow does afterwards.
  const response = await page.goto("/quiz", { waitUntil: "commit" });
  expect(response).not.toBeNull();

  const cookies = await page.context().cookies();
  const returnTo = cookies.find((c) => c.name === "sb_return_to");

  expect(returnTo, "middleware should park the intended destination").toBeDefined();

  // Next URL-encodes cookie values on the way out ("%2Fquiz"), which is why the
  // client reader in components/return-to.tsx decodes before using the value.
  expect(decodeURIComponent(returnTo?.value ?? "")).toBe("/quiz");
});
