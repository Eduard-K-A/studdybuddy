import path from "node:path";

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const FIXTURE_PDF = path.join(__dirname, "..", "fixtures", "sn2-notes.pdf");

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

test("an uploaded PDF becomes editable material", async ({ page }) => {
  await page.goto("/quiz");
  await page.getByLabel(/upload a file/i).setInputFiles(FIXTURE_PDF);

  // The whole point of routing extraction through the textarea rather than
  // starting a session directly: the learner can see and trim what was read.
  const material = page.getByLabel("Your material");
  await expect(material).toHaveValue(/trigonal bipyramidal/i, {
    timeout: 30_000,
  });

  // Lines wrapped by the PDF renderer are rejoined, and a word hyphenated
  // across a break is made whole again — "nucleo-\nphile".
  await expect(material).toHaveValue(/nucleophile/i);

  // The filename fills the title the learner left blank, and says so.
  await expect(page.getByLabel(/what is this\?/i)).toHaveValue("sn2 notes");
  await expect(page.getByText(/from sn2-notes\.pdf/i)).toBeVisible();

  await expect(
    page.getByRole("button", { name: /start quizzing me/i }),
  ).toBeEnabled();
});

test("a file type we cannot read is refused with an actionable message", async ({
  page,
}) => {
  await page.goto("/quiz");
  await page.getByLabel(/upload a file/i).setInputFiles({
    name: "lecture-slides.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from("not really a deck"),
  });

  // Scoped to the form: Next mounts its own empty role="alert" route announcer
  // on every page, so an unscoped alert lookup is ambiguous by construction.
  const alert = page.locator("form").getByRole("alert");

  // Rejected in the browser, so no round trip is spent on it.
  await expect(alert).toContainText(/\.pptx/);
  await expect(alert).toContainText(/PDF, Word/i);
  await expect(page.getByLabel("Your material")).toHaveValue("");
});

test("the empty state has no critical or serious accessibility violations", async ({
  page,
}) => {
  // Scanned separately from the answered surface below: the upload controls
  // only exist here, and a file input beside a drop target is exactly the sort
  // of thing that ends up with an unlabelled control.
  await page.goto("/quiz");
  await expect(page.getByLabel("Your material")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(
    results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    ),
  ).toEqual([]);
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
