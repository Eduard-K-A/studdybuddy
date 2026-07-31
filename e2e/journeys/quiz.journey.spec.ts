import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The quiz journey.
 *
 * These run with the storage state saved by auth.setup.ts, so the session is
 * already authenticated. The unauthenticated redirect is asserted separately in
 * auth.journey.spec.ts, which runs without that state.
 */

const MATERIAL = `The SN2 reaction proceeds through a single concerted step.
The nucleophile attacks the electrophilic carbon from the face opposite the
leaving group. This backside attack forces the transition state to adopt a
trigonal bipyramidal geometry, in which the three non-reacting substituents lie
in a plane. Because the nucleophile and the leaving group occupy axial
positions, the stereochemistry at the carbon is inverted, a result known as
Walden inversion. Steric bulk around the electrophilic carbon slows the
reaction sharply, which is why tertiary halides are poor SN2 substrates.`;

async function startSession(page: import("@playwright/test").Page) {
  await page.goto("/quiz");
  await page.getByLabel("Your material").fill(MATERIAL);
  await page.getByRole("button", { name: /start quizzing me/i }).click();
  await expect(page.getByLabel("Your answer")).toBeVisible({ timeout: 30_000 });
}

test("renders the quiz page for an authenticated user", async ({ page }) => {
  await page.goto("/quiz");
  await expect(page.getByRole("heading", { name: "StudyBuddy" })).toBeVisible();
  await expect(page.getByLabel("Your material")).toBeVisible();
});

test("refuses material that is too short to quiz on", async ({ page }) => {
  await page.goto("/quiz");
  await page.getByLabel("Your material").fill("too short");
  await expect(page.getByRole("button", { name: /start quizzing me/i })).toBeDisabled();
  await expect(page.getByText(/bit short to build questions from/i)).toBeVisible();
});

test("submitting an answer produces an evaluation in the margin rail", async ({
  page,
}) => {
  await startSession(page);

  const rail = page.getByRole("complementary", { name: /feedback and score/i });
  await expect(rail).toContainText(/evaluation will appear here/i);

  await page
    .getByLabel("Your answer")
    .fill(
      "The backside attack forces a trigonal bipyramidal transition state, and the stereochemistry is inverted.",
    );
  await page.getByRole("button", { name: /check my answer/i }).click();

  // A verdict must appear, and it must carry a TEXT label — colour is never the
  // sole carrier of the result.
  await expect(rail.getByText(/correct|nearly|revisit/i).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(rail).toContainText(/source/i);

  // The action keeps its name through the flow, then advances.
  await expect(page.getByRole("button", { name: /next question/i })).toBeVisible();
});

test("quiz page has no critical or serious accessibility violations", async ({
  page,
}) => {
  await startSession(page);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const serious = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );

  // Print the detail so a failure is actionable rather than just a count.
  if (serious.length > 0) {
    console.error(
      JSON.stringify(
        serious.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })),
        null,
        2,
      ),
    );
  }

  expect(serious).toEqual([]);
});
