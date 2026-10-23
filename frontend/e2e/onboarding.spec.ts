import { expect, test } from "@playwright/test";

test("first-visit onboarding and tour complete once and persist", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem("vesting_intro_complete");
    localStorage.removeItem("vesting_onboarding_complete");
  });
  await page.goto("/");

  const introduction = page.getByRole("dialog");
  await expect(
    introduction.getByRole("heading", { name: "What is a vesting stream?" }),
  ).toBeVisible();
  await expect(
    introduction.getByRole("img", {
      name: /tokens are locked from the start until the cliff/i,
    }),
  ).toBeVisible();

  await introduction.getByRole("button", { name: "Next" }).click({ force: true });
  await expect(
    introduction.getByRole("heading", { name: "What is a cliff?" }),
  ).toBeVisible();
  const cliffTerm = introduction.getByRole("button", { name: "Cliff" });
  await cliffTerm.hover({ force: true });
  await expect(page.getByRole("tooltip")).toContainText(
    "A mandatory waiting period",
  );

  await introduction.getByRole("button", { name: "Next" }).click({ force: true });
  const storageTerm = introduction.getByRole("button", {
    name: "persistent storage",
  });
  await storageTerm.hover({ force: true });
  await expect(page.getByRole("tooltip")).toContainText(
    "Soroban storage for contract data",
  );
  await introduction.getByRole("button", { name: "Finish" }).click({ force: true });

  const tour = page.getByRole("dialog");
  const tourTitles = [
    "Connect your wallet",
    "Set the stream details",
    "Choose the cliff",
    "Create the stream",
  ];
  for (const [index, title] of tourTitles.entries()) {
    await expect(tour.getByRole("heading", { name: title })).toBeVisible();
    if (index < tourTitles.length - 1) {
      await tour.getByRole("button", { name: "Next" }).click({ force: true });
    } else {
      await tour.getByRole("button", { name: "Finish" }).click({ force: true });
    }
  }

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          [
            localStorage.getItem("vesting_intro_complete"),
            localStorage.getItem("vesting_onboarding_complete"),
          ] as const,
      ),
    )
    .toEqual(["true", "true"]);

  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
