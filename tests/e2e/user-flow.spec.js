const { test, expect } = require('@playwright/test');

test.describe('3AM Channel E2E Tests', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to app
        await page.goto('http://localhost:3000');
    });

    test('should show closed screen outside of operating hours', async ({ page }) => {
        const closedScreen = page.locator('#closed-screen');
        const isVisible = await closedScreen.isVisible();

        // Should be visible if outside 2:45-4:00 AM
        const now = new Date();
        const hours = now.getHours();
        const isOpenTime = (hours === 2 || hours === 3) &&
            (hours > 2 || now.getMinutes() >= 45) &&
            (hours < 4);

        if (!isOpenTime) {
            expect(isVisible).toBe(true);
        }
    });

    test('should bypass time check in dev mode', async ({ page }) => {
        // Click bypass button
        const bypassBtn = page.locator('#bypass-btn');
        await bypassBtn.click();

        // Should now show open screen
        const openScreen = page.locator('#open-screen');
        await expect(openScreen).toBeVisible({ timeout: 5000 });
    });

    test('complete user flow - create post and react', async ({ page }) => {
        // Bypass time check
        await page.locator('#bypass-btn').click();
        await page.waitForSelector('#open-screen', { state: 'visible' });

        // Type a post
        const input = page.locator('#post-input');
        await input.fill('This is an E2E test post');

        // Post button should be enabled
        const postButton = page.locator('#post-button');
        await expect(postButton).toBeEnabled();

        // Submit post
        await postButton.click();

        // Wait for post to appear in feed
        await page.waitForSelector('.post-card', { timeout: 5000 });

        // Verify post content
        const firstPost = page.locator('.post-card').first();
        await expect(firstPost).toContainText('This is an E2E test post');

        // Add a reaction
        const reactionBtn = firstPost.locator('.reaction-btn[data-emoji="🤍"]');
        await reactionBtn.click();

        // Verify reaction was added
        await expect(reactionBtn).toHaveClass(/reacted/);

        // Remove reaction by clicking again
        await reactionBtn.click();
        await expect(reactionBtn).not.toHaveClass(/reacted/);
    });

    test('should show active user count', async ({ page }) => {
        await page.locator('#bypass-btn').click();
        await page.waitForSelector('#open-screen');

        const userCount = page.locator('#user-count-value');
        const count = await userCount.textContent();

        expect(parseInt(count)).toBeGreaterThanOrEqual(0);
    });

    test('should disable post button when content is empty', async ({ page }) => {
        await page.locator('#bypass-btn').click();
        await page.waitForSelector('#open-screen');

        const postButton = page.locator('#post-button');
        await expect(postButton).toBeDisabled();

        // Type something
        await page.locator('#post-input').fill('Test');
        await expect(postButton).toBeEnabled();

        // Clear it
        await page.locator('#post-input').fill('');
        await expect(postButton).toBeDisabled();
    });

    test('should respect character limit', async ({ page }) => {
        await page.locator('#bypass-btn').click();
        await page.waitForSelector('#open-screen');

        const input = page.locator('#post-input');
        const longText = 'a'.repeat(501);

        await input.fill(longText);

        // Input should truncate or prevent
        const value = await input.inputValue();
        expect(value.length).toBeLessThanOrEqual(500);
    });

    test('PWA manifest should be accessible', async ({ page }) => {
        const manifestLink = page.locator('link[rel="manifest"]');
        expect(await manifestLink.count()).toBe(1);

        const href = await manifestLink.getAttribute('href');
        const response = await page.goto(`http://localhost:3000${href}`);
        expect(response.ok()).toBe(true);
    });

    test('should show countdown timer on closed screen', async ({ page }) => {
        //Navigate without bypass
        const countdown = page.locator('#countdown');

        if (await countdown.isVisible()) {
            const text = await countdown.textContent();
            // Should have format like "12:34:56" or similar
            expect(text).toMatch(/\d+:\d+:\d+/);
        }
    });

    test('real-time updates via Socket.io', async ({ page, context }) => {
        // Open first tab
        await page.locator('#bypass-btn').click();
        await page.waitForSelector('#open-screen');

        // Create a post
        await page.locator('#post-input').fill('Real-time test');
        await page.locator('#post-button').click();
        await page.waitForSelector('.post-card');

        // Open second tab
        const page2 = await context.newPage();
        await page2.goto('http://localhost:3000');
        await page2.locator('#bypass-btn').click();
        await page2.waitForSelector('#open-screen');

        // Second tab should see the post from first tab
        await expect(page2.locator('.post-card').first()).toContainText('Real-time test', {
            timeout: 5000
        });
    });
});
