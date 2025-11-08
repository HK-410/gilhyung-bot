import type { VercelRequest, VercelResponse } from '@vercel/node';
import KoreanLunarCalendar from 'korean-lunar-calendar';
import { TwitterApi } from 'twitter-api-v2';
import Groq from 'groq-sdk';
import twitter from 'twitter-text';

const MAX_TWEET_BYTES = 280;

const TWEET_RULE = `<출력 조건>
- [페르소나], 짧은 운세, 창의적인 '행운의 아이템'을 포함합니다.
- 출력 내용은 240바이트(한국어 기준 120자) 미만이어야 합니다.
- 각 줄의 운세 내용은 간결하게 작성합니다.
- 페르소나 이름은 전달된 이름(예: [목(木) PM])을 그대로 사용합니다.
- 다른 인사말이나 부가 설명 없이, 반드시 <출력 포맷>에 정확히 맞춰 결과만 출력합니다.

<출력 포맷>
길(吉): [페르소나] - [운세 내용] (행운 아이템: [아이템])
흉(凶): [페르소나] - [운세 내용] (행운 아이템: [아이템])`;

const CHEONGAN_DB = {
  '갑': { ohaeng: '목', yinYang: 'yang' }, '을': { ohaeng: '목', yinYang: 'yin' },
  '병': { ohaeng: '화', yinYang: 'yang' }, '정': { ohaeng: '화', yinYang: 'yin' },
  '무': { ohaeng: '토', yinYang: 'yang' }, '기': { ohaeng: '토', yinYang: 'yin' },
  '경': { ohaeng: '금', yinYang: 'yang' }, '신': { ohaeng: '금', yinYang: 'yin' },
  '임': { ohaeng: '수', yinYang: 'yang' }, '계': { ohaeng: '수', yinYang: 'yin' },
};
const PERSONA_DB = {
  '[목(木) PM]': CHEONGAN_DB['갑'], '[화(火) 디자이너]': CHEONGAN_DB['병'],
  '[토(土) 인프라/DBA]': CHEONGAN_DB['무'], '[금(金) 개발자]': CHEONGAN_DB['경'],
  '[수(水) DevOps/SRE]': CHEONGAN_DB['임'],
};

function getShipshin(ilgan: { ohaeng: string, yinYang: string }, todayCheongan: { ohaeng: string, yinYang: string }): string {
  const OHAENG_REL = {
    '목': '화', '화': '토', '토': '금', '금': '수', '수': '목',
    '목_극': '토', '화_극': '금', '토_극': '수', '금_극': '목', '수_극': '화',
    '목_생': '수', '화_생': '목', '토_생': '화', '금_생': '토', '수_생': '금',
    '목_극당': '금', '화_극당': '수', '토_극당': '목', '금_극당': '화', '수_극당': '토',
  };
  const isSameYinYang = ilgan.yinYang === todayCheongan.yinYang;
  if (ilgan.ohaeng === todayCheongan.ohaeng) return isSameYinYang ? '비견' : '겁재';
  if (OHAENG_REL[ilgan.ohaeng as keyof typeof OHAENG_REL] === todayCheongan.ohaeng) return isSameYinYang ? '식신' : '상관';
  if (OHAENG_REL[`${ilgan.ohaeng}_극` as keyof typeof OHAENG_REL] === todayCheongan.ohaeng) return isSameYinYang ? '편재' : '정재';
  if (OHAENG_REL[`${ilgan.ohaeng}_극당` as keyof typeof OHAENG_REL] === todayCheongan.ohaeng) return isSameYinYang ? '편관' : '정관';
  if (OHAENG_REL[`${ilgan.ohaeng}_생` as keyof typeof OHAENG_REL] === todayCheongan.ohaeng) return isSameYinYang ? '편인' : '정인';
  return '계산 불가';
}

const systemPrompt = `당신은 '오행투데이' 봇입니다. IT 직무별 오늘의 운세 순위를 트윗합니다.
<지식베이스: 십신(十神) 해석 및 순위 가중치>
[길(吉)] 정재(성과), 정관(인정), 식신(창의), 정인(문서), 비견(협업)
[흉(凶)] 편재(유동성), 편인(변덕), 겁재(경쟁), 상관(충돌), 편관(장애)

<지식베이스>에 따라 가장 운이 좋은 '길(吉)'과 가장 나쁜 '흉(凶)'을 하나씩 추출하여 <출력 조건>에 따라 <출력 포맷>에 맞춰 출력합니다.` + '\n\n' + TWEET_RULE;

// --- 메인 핸들러 ---
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  const authHeader = req.headers['authorization'];
  console.log(authHeader);
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).send('Unauthorized: Access Denied');
  }
  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }

  const isDryRun = req.query.dryRun === 'true';

  try {
    const kstTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' });
    const kstDate = new Date(kstTime);
    const calendar = new KoreanLunarCalendar();
    calendar.setSolarDate(kstDate.getFullYear(), kstDate.getMonth() + 1, kstDate.getDate());
    const iljin: string = calendar.getKoreanGapja().day;
    const todayCheonganChar: string = iljin.charAt(0);
    const todayCheonganData = CHEONGAN_DB[todayCheonganChar as keyof typeof CHEONGAN_DB];

    const shipshinResults: string[] = [];
    for (const [personaName, ilganData] of Object.entries(PERSONA_DB)) {
      const shipshin = getShipshin(ilganData, todayCheonganData);
      shipshinResults.push(`- ${personaName}은(는) [${shipshin}]입니다.`);
    }
    const fullDateString = `${kstDate.getFullYear()}년 ${kstDate.getMonth() + 1}월 ${kstDate.getDate()}일`;
    const userPrompt = `오늘은 ${iljin} (${fullDateString})입니다.\n십신 계산 결과:\n${shipshinResults.join('\n')}\n\n위 결과를 <지식베이스>에 따라 1-5위로 정렬하고, 'IT 직무 해석'을 결합하여 <출력 포맷>에 맞는 최종 트윗을 생성해 주세요.`;

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    let chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      temperature: 0.75,
    });

    let generatedContent = chatCompletion.choices[0]?.message?.content;

    if (!generatedContent) {
      throw new Error('Groq API did not return valid content.');
    }

    const todayString = `${fullDateString} 오늘의 직무 길흉`

    if (twitter.parseTweet(`${todayString}\n\n${generatedContent}`).weightedLength > MAX_TWEET_BYTES) {
      chatCompletion = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: '입력되는 텍스트를 240바이트(한국어 120자) 미만으로 줄여주세요.' + '\n\n' + TWEET_RULE },
          { role: 'user', content: generatedContent },
        ],
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        temperature: 0.75,
      });
      generatedContent = chatCompletion.choices[0]?.message?.content ?? generatedContent;
    }

    let tweetContent = ''
    if (twitter.parseTweet(`${todayString}\n\n${generatedContent}`).weightedLength > MAX_TWEET_BYTES) {
      tweetContent = `${todayString}은 부득이한 사정으로 쉬어갑니다...`;
    } else {
      tweetContent = `${todayString}\n\n${generatedContent}`;
    }

    if (!isDryRun) {
      const twitterClient = new TwitterApi({
        appKey: process.env.X_APP_KEY as string,
        appSecret: process.env.X_APP_SECRET as string,
        accessToken: process.env.X_ACCESS_TOKEN as string,
        accessSecret: process.env.X_ACCESS_SECRET as string,
      });

      await twitterClient.v2.tweet(tweetContent);
      console.log('Tweet successfully posted.');
    } else {
      console.log('--- [DRY RUN] ---');
      console.log('[Output] Generated Content:\n' + tweetContent);
      console.log('---------------------------------');
    }

    return res.status(200).json({
      success: true,
      dryRun: isDryRun,
      tweet: tweetContent,
    });

  } catch (error) {
    console.error('Error executing daily:', error);
    let errorMessage = 'An unknown error occurred.';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    return res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
}
