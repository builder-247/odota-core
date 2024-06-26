/**
 * Processes a queue of parse jobs
 * The actual parsing is done by invoking the Java-based parser.
 * This produces an event stream (newline-delimited JSON)
 * Stream is run through a series of processors to count/aggregate it into a single object
 * This object is passed to insertMatch to persist the data into the database.
 * */
import { getOrFetchGcDataWithRetry } from '../store/getGcData';
import config from '../config';
import { runReliableQueue } from '../store/queue';
import c from 'ansi-colors';
import { buildReplayUrl, redisCount } from '../util/utility';
import redis from '../store/redis';
import { getOrFetchApiData } from '../store/getApiData';
import { checkIsParsed, getOrFetchParseData } from '../store/getParsedData';

const { PARSER_PARALLELISM } = config;

async function parseProcessor(job: ParseJob) {
  const start = Date.now();
  let apiTime = 0;
  let gcTime = 0;
  let parseTime = 0;
  try {
    redisCount(redis, 'parser_job');
    const matchId = job.match_id;

    // Check if match is in safe integer range
    // Javascript supports up to 2^53 -1, although match IDs can go up to 2^63 - 1
    // If we want to handle values outside the range we'll need to use BigInt type in JS
    if (
      matchId > Number.MAX_SAFE_INTEGER ||
      matchId < Number.MIN_SAFE_INTEGER
    ) {
      log('skip');
      return true;
    }

    // Check if match is already parsed according to PG
    // Doing the check early means we don't verify API or gcdata
    if (await checkIsParsed(matchId)) {
      redisCount(redis, 'reparse_early');
      if (config.DISABLE_REPARSE_EARLY) {
        // If high load, we can disable parsing already parsed matches
        log('skip');
        return true;
      }
    }

    // Fetch the API data
    const apiStart = Date.now();
    // The pgroup is used to update player_caches on insert.
    // Since currently gcdata and parse data have no knowledge of anonymity, we pass it from API data
    const noRetry = job.origin !== 'scanner';
    let {
      data: apiMatch,
      error: apiError,
      pgroup,
    } = await getOrFetchApiData(matchId, noRetry);
    apiTime = Date.now() - apiStart;
    if (apiError || !apiMatch || !pgroup) {
      log('fail', apiError || 'Missing API data or pgroup');
      return false;
    }

    const { leagueid, duration, start_time } = apiMatch;
    if (!leagueid && Date.now() / 1000 - start_time > 30 * 24 * 60 * 60) {
      redisCount(redis, 'oldparse');
      if (config.DISABLE_OLD_PARSE) {
        // Valve doesn't keep non-league replays for more than a few weeks.
        // Skip even attempting the parse if it's too old
        log('skip');
        return true;
      }
    }

    // Fetch the gcdata and construct a replay URL
    const gcStart = Date.now();
    const { data: gcMatch, error: gcError } = await getOrFetchGcDataWithRetry(
      matchId,
      {
        pgroup,
        origin: job.origin,
      },
    );
    if (!gcMatch) {
      // non-retryable error
      log('fail', gcError || 'Missing gcdata');
      return false;
    }
    gcTime = Date.now() - gcStart;
    let url = buildReplayUrl(
      gcMatch.match_id,
      gcMatch.cluster,
      gcMatch.replay_salt,
    );

    const parseStart = Date.now();
    const { error: parseError, skipped } = await getOrFetchParseData(
      matchId,
      url,
      {
        start_time,
        duration,
        leagueid,
        pgroup,
        origin: job.origin,
      },
    );
    parseTime = Date.now() - parseStart;
    if (parseError) {
      console.log('[PARSER] %s: %s', matchId, parseError);
      log('fail', parseError);
      return false;
    }
    if (skipped) {
      log('skip');
      return true;
    }

    // Log successful parse and timing
    log('success');
    return true;
  } catch (e: any) {
    log('crash', e?.message);
    // Rethrow the exception
    throw e;
  }

  function log(
    type: 'fail' | 'crash' | 'success' | 'skip',
    error?: string | null,
  ) {
    const end = Date.now();
    const colors: Record<typeof type, 'yellow' | 'red' | 'green' | 'gray'> = {
      fail: 'yellow',
      crash: 'red',
      success: 'green',
      skip: 'gray',
    };
    const message = c[colors[type]](
      `[${new Date().toISOString()}] [parser] [${type}: ${
        end - start
      }ms] [api: ${apiTime}ms] [gcdata: ${gcTime}ms] [parse: ${parseTime}ms] ${
        job.match_id
      }: ${error ?? ''}`,
    );
    redis.publish('parsed', message);
    console.log(message);
    if (type === 'fail') {
      redisCount(redis, 'parser_fail');
    } else if (type === 'crash') {
      redisCount(redis, 'parser_crash');
    } else if (type === 'skip') {
      redisCount(redis, 'parser_skip');
    }
  }
}
async function getCapacity() {
  if (config.USE_SERVICE_REGISTRY) {
    return redis.zcard('registry:parser');
  }
  return Number(PARSER_PARALLELISM);
}
runReliableQueue('parse', Number(PARSER_PARALLELISM), parseProcessor, getCapacity);
