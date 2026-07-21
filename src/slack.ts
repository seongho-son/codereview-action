import * as core from "@actions/core";
import { WebClient } from "@slack/web-api";

import {
  CODE_FENCE,
  SLACK_SECTION_TEXT_LIMIT,
  TRUNCATION_NOTICE,
} from "./constants";

const slackToken: string = core.getInput("slack_token");
const slackChannel: string = core.getInput("slack_channel");

export const slackClient = new WebClient(slackToken);

// Slack rejects the whole message(invalid_blocks) when a section exceeds the limit,
// so long PR bodies and comments are cut instead of losing the notification.
function truncateSectionText(text: string): string {
  if (text.length <= SLACK_SECTION_TEXT_LIMIT) return text;

  const kept = text.slice(
    0,
    SLACK_SECTION_TEXT_LIMIT - TRUNCATION_NOTICE.length - CODE_FENCE.length
  );
  // cutting inside a code block would drop its closing fence
  const isInsideCodeBlock = (kept.split(CODE_FENCE).length - 1) % 2 === 1;

  return isInsideCodeBlock
    ? `${kept}${TRUNCATION_NOTICE}${CODE_FENCE}`
    : `${kept}${TRUNCATION_NOTICE}`;
}

function truncateBlocks(blocks: any): any {
  if (!Array.isArray(blocks)) return blocks;

  return blocks.map((block) =>
    typeof block?.text?.text === "string"
      ? {
          ...block,
          text: { ...block.text, text: truncateSectionText(block.text.text) },
        }
      : block
  );
}

export async function getSlackMessage(ts: string) {
  const result = await slackClient.conversations.history({
    channel: slackChannel,
    latest: ts,
    limit: 1,
    inclusive: true,
  });

  if (result.messages && result.messages.length > 0) {
    return result.messages[0];
  }

  return null;
}

export async function postMessage(blocks: any) {
  const res = await slackClient.chat.postMessage({
    channel: slackChannel,
    blocks: truncateBlocks(blocks),
    text: blocks[0]?.text?.text || "pr open message",
  });
  return res.ts;
}

export async function updateMessage(ts: string, blocks: any) {
  await slackClient.chat.update({
    channel: slackChannel,
    ts,
    blocks: truncateBlocks(blocks),
    text: blocks[0]?.text?.text || "update pr open message(request review)",
  });
}

export async function postThreadMessage(ts: string, text: string) {
  if (!text.includes("![image](")) {
    return await slackClient.chat.postMessage({
      channel: slackChannel,
      text: text || "post thread message",
      thread_ts: ts,
    });
  }

  // support image
  await slackClient.chat.postMessage({
    channel: slackChannel,
    blocks: truncateBlocks(parseTextToBlocks(text)),
    thread_ts: ts,
    text: text || "post thread message",
  });
}

export async function addReaction(ts: string, emoji: string) {
  await slackClient.reactions.add({
    channel: slackChannel,
    name: emoji,
    timestamp: ts,
  });
}

export async function addCommentToPR(
  octokit: any,
  prNumber: number,
  owner: string,
  repo: string,
  comment: string
) {
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: comment,
  });
}

function parseTextToBlocks(text: string): any[] {
  const imgTagRegex = /!\[image\]\(([^)]+)\)/g;
  let match;
  const blocks: any[] = [];
  let lastIndex = 0;

  while ((match = imgTagRegex.exec(text)) !== null) {
    // Add text block before the image
    if (match.index > lastIndex) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: text.substring(lastIndex, match.index).trim(),
        },
      });
    }

    // Add image block
    blocks.push({
      type: "image",
      image_url: match[1],
      alt_text: "image",
    });

    lastIndex = imgTagRegex.lastIndex;
  }

  // Add remaining text block
  if (lastIndex < text.length) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: text.substring(lastIndex).trim(),
      },
    });
  }

  core.info(JSON.stringify(blocks));

  return blocks;
}
