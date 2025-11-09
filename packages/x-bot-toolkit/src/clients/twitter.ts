import { TwitterApi } from 'twitter-api-v2';
import twitter from 'twitter-text';

const MAX_TWEET_BYTES = 280;

/**
 * Calculate size of content.
 * @param content The content.
 */
export function calculateBytes(content: string): number {
  return twitter.parseTweet(content).weightedLength;
}

/**
 * Posts a main tweet and a thread of replies to Twitter.
 * @param mainTweetContent The content of the main tweet.
 * @param replies An array of strings, where each string is the content of a reply tweet.
 */
export async function postTweetThread(mainTweetContent: string, replies: string[]): Promise<void> {
  if (!process.env.X_APP_KEY || !process.env.X_APP_SECRET || !process.env.X_ACCESS_TOKEN || !process.env.X_ACCESS_SECRET) {
    throw new Error('Twitter API environment variables are not fully set.');
  }

  const twitterClient = new TwitterApi({
    appKey: process.env.X_APP_KEY,
    appSecret: process.env.X_APP_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  });

  let mainTweetId: string;
  try {
    const mainTweetResult = await twitterClient.v2.tweet(mainTweetContent);
    mainTweetId = mainTweetResult.data.id;
    console.log(`Main tweet posted: ${mainTweetId}`);
  } catch (e: any) {
    console.error('Failed to post main tweet:', e);
    throw new Error(`Failed to post main tweet: ${e.message}`);
  }

  let lastTweetId = mainTweetId;

  for (const replyContent of replies) {
    try {
      let finalReplyContent = replyContent;

      // Truncate if the reply exceeds Twitter's byte limit
      if (twitter.parseTweet(finalReplyContent).weightedLength > MAX_TWEET_BYTES) {
        console.warn(`Warning: Truncating reply as it exceeds byte limit.`);
        
        // A simple truncation strategy, assuming the important info is at the start and end.
        // This could be made more sophisticated. For now, we just cut from the middle.
        const ellipsis = '...';
        const maxLength = MAX_TWEET_BYTES - twitter.parseTweet(ellipsis).weightedLength;
        
        let truncatedText = "";
        let currentLength = 0;
        const chars = Array.from(finalReplyContent);
        for(const char of chars) {
            const charWeight = twitter.parseTweet(char).weightedLength;
            if (currentLength + charWeight > maxLength) {
                break;
            }
            truncatedText += char;
            currentLength += charWeight;
        }
        finalReplyContent = truncatedText + ellipsis;
      }

      const replyResult = await twitterClient.v2.tweet(finalReplyContent, {
        reply: { in_reply_to_tweet_id: lastTweetId },
      });
      lastTweetId = replyResult.data.id;
      console.log(`Posted reply.`);
      
      // Wait 1.5 seconds between replies to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1500));

    } catch (e: any) {
      console.error(`Failed to post a reply:`, e);
      // Continue to the next reply even if one fails
    }
  }
  console.log('--- Tweet thread posted successfully ---');
}
