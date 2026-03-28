#!/usr/bin/env node
/**
 * scripts/fetch-jobs.js
 *
 * 1. Fetches jobs from Adzuna API (PMM + Finance queries)
 * 2. Scrapes target company career pages via Cheerio
 * 3. Deduplicates by URL against existing Supabase records
 * 4. Scores each new job via Claude API
 * 5. Upserts to Supabase
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 *   ADZUNA_APP_ID, ADZUNA_API_KEY
 *   ANTHROPIC_API_KEY
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import axios from 'axios'
import { load as cheerioLoad } from 'cheerio'

// ── Config ───────────────────────────────────────────────────────────────────

const { SUPABASE_URL, SUPABASE_ANON_KEY, ADZUNA_APP_ID, ADZUNA_API_KEY, ANTHROPIC_API_KEY } =
  process.env

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null

// ── Candidate profiles for Claude scoring ────────────────────────────────────

const PMM_PROFILE = `Senior Product Marketing leader with 10+ years B2B/B2C experience.
Built and scaled PMM functions at high-growth tech companies (SaaS, FinTech, Marketplace).
Led go-to-market strategy, product launches, competitive positioning, and analyst relations.
Managed teams of 8–15, partnered with C-suite on market strategy and category creation.
Track record: 3 product launches (€50M+ ARR), 2x win rates via competitive enablement.
Based in Amsterdam. Targeting Director, VP, Head of PMM roles.`

const FINANCE_PROFILE = `Senior Finance professional with 8+ years in FP&A and controlling.
Experience at scale-ups and enterprise tech companies (SaaS, FinTech, E-commerce).
Led budget cycles, financial modeling, monthly close, and management reporting.
Partnered with business leaders on performance reviews, forecasting, and cost optimization.
CPA / CIMA qualified. Track record delivering insights that drove 15% OpEx savings.
Based in Amsterdam. Targeting Senior Controller, Finance Manager, Controlling Manager roles.`

// ── Keyword lists ─────────────────────────────────────────────────────────────

const PMM_KEYWORDS = ['product marketing', 'pmm', 'product marketer']
const FINANCE_KEYWORDS = [
  'controller',
  'finance manager',
  'controlling',
  'financial manager',
  'financial controller',
  'fp&a',
  'financial planning',
]

// ── Adzuna API ────────────────────────────────────────────────────────────────

async function fetchAdzuna(query, tab) {
  if (!ADZUNA_APP_ID || !ADZUNA_API_KEY) {
    console.warn('Adzuna credentials not set — skipping')
    return []
  }
  try {
    const { data } = await axios.get('https://api.adzuna.com/v1/api/jobs/nl/search/1', {
      params: {
        app_id: ADZUNA_APP_ID,
        app_key: ADZUNA_API_KEY,
        what: query,
        where: 'amsterdam',
        results_per_page: 50,
        sort_by: 'date',
      },
      timeout: 30_000,
    })
    const results = data.results ?? []
    console.log(`Adzuna [${tab}]: ${results.length} results`)
    return results.map(job => ({
      tab,
      title: job.title,
      company: job.company?.display_name ?? 'Unknown',
      location: job.location?.display_name ?? 'Amsterdam',
      url: job.redirect_url,
      postedDate: job.created?.split('T')[0] ?? null,
      salaryMin: job.salary_min ? Math.round(job.salary_min) : null,
      salaryMax: job.salary_max ? Math.round(job.salary_max) : null,
      description: job.description ?? '',
      source: 'adzuna',
    }))
  } catch (err) {
    console.error(`Adzuna [${tab}] failed: ${err.message}`)
    return []
  }
}

// ── Greenhouse JSON API ───────────────────────────────────────────────────────
// Many Dutch tech companies run Greenhouse; the JSON API is reliable and polite.

async function fetchGreenhouse(boardToken, company, tab, keywords) {
  try {
    const { data } = await axios.get(
      `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs`,
      { params: { content: true }, timeout: 15_000 },
    )
    const jobs = (data.jobs ?? [])
      .filter(job => {
        const lower = job.title.toLowerCase()
        return keywords.some(kw => lower.includes(kw))
      })
      .map(job => ({
        tab,
        title: job.title,
        company,
        location: job.location?.name ?? 'Amsterdam',
        url: job.absolute_url,
        postedDate: job.updated_at?.split('T')[0] ?? null,
        salaryMin: null,
        salaryMax: null,
        description: job.content ? cheerioLoad(job.content).text().slice(0, 600) : '',
        source: 'career_page',
      }))
    console.log(`Greenhouse [${company}]: ${jobs.length} matching jobs`)
    return jobs
  } catch (err) {
    console.warn(`Greenhouse [${boardToken}] failed: ${err.message}`)
    return []
  }
}

// ── Generic Cheerio scraper ───────────────────────────────────────────────────

async function scrapeCareerPage(url, company, tab, keywords) {
  try {
    const { data: html } = await axios.get(url, {
      timeout: 20_000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    const $ = cheerioLoad(html)
    const found = []
    const seen = new Set()

    $('a[href]').each((_, el) => {
      const text = $(el).text().trim().replace(/\s+/g, ' ')
      if (!text || text.length < 5 || text.length > 200) return
      const lower = text.toLowerCase()
      if (!keywords.some(kw => lower.includes(kw))) return

      const href = $(el).attr('href')
      if (!href) return
      const fullUrl = href.startsWith('http') ? href : new URL(href, url).href
      if (seen.has(fullUrl)) return
      seen.add(fullUrl)

      found.push({
        tab,
        title: text,
        company,
        location: 'Amsterdam',
        url: fullUrl,
        postedDate: null,
        salaryMin: null,
        salaryMax: null,
        description: '',
        source: 'career_page',
      })
    })

    console.log(`Scraped [${company}]: ${found.length} matching jobs`)
    return found
  } catch (err) {
    console.warn(`Scrape [${company}] failed: ${err.message}`)
    return []
  }
}

// ── Career page targets ───────────────────────────────────────────────────────

async function scrapeAllCareerPages() {
  const results = []

  // Greenhouse API (JSON, reliable)
  results.push(...(await fetchGreenhouse('templafy', 'Templafy', 'pmm', PMM_KEYWORDS)))
  results.push(...(await fetchGreenhouse('getyourguide', 'GetYourGuide', 'pmm', PMM_KEYWORDS)))
  results.push(
    ...(await fetchGreenhouse('getyourguide', 'GetYourGuide', 'finance', FINANCE_KEYWORDS)),
  )

  // HTML scraping for non-Greenhouse sites (some are SPAs; links still appear in SSR HTML)
  const targets = [
    { url: 'https://careers.adyen.com', company: 'Adyen', tabs: ['pmm', 'finance'] },
    { url: 'https://jobs.booking.com', company: 'Booking.com', tabs: ['pmm', 'finance'] },
    { url: 'https://www.asml.com/en/careers', company: 'ASML', tabs: ['finance'] },
    { url: 'https://www.mollie.com/en/careers', company: 'Mollie', tabs: ['pmm', 'finance'] },
    { url: 'https://careers.takeaway.com', company: 'Just Eat Takeaway', tabs: ['pmm', 'finance'] },
    { url: 'https://jobs.picnic.app', company: 'Picnic', tabs: ['finance'] },
    { url: 'https://jobs.tesla.com/en_us/filter#?filterOptions=location_Amsterdam', company: 'Tesla', tabs: ['finance'] },
  ]

  for (const { url, company, tabs } of targets) {
    for (const tab of tabs) {
      const kw = tab === 'pmm' ? PMM_KEYWORDS : FINANCE_KEYWORDS
      results.push(...(await scrapeCareerPage(url, company, tab, kw)))
    }
    // Polite delay between sites
    await sleep(1000)
  }

  return results
}

// ── Claude scoring ────────────────────────────────────────────────────────────

async function scoreJob(job) {
  if (!anthropic) {
    console.warn('ANTHROPIC_API_KEY not set — using defaults')
    return defaultScoring()
  }
  const profile = job.tab === 'pmm' ? PMM_PROFILE : FINANCE_PROFILE
  const prompt = `You are evaluating job fit for a candidate with this profile:
${profile}

Job: ${job.title} at ${job.company}
Description: ${job.description.slice(0, 600) || 'Not available'}

Return JSON only:
{
  "match_score": 0-100,
  "seniority_level": "Director|VP|Head of|Senior Manager",
  "company_size": "startup|scale-up|enterprise",
  "industry": "string",
  "salary_estimate_min": number or null,
  "salary_estimate_max": number or null,
  "reasoning": "1 sentence"
}`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content[0].text
    const jsonStr = text.match(/\{[\s\S]*\}/)?.[0]
    return JSON.parse(jsonStr)
  } catch (err) {
    console.error(`Scoring failed for "${job.title}": ${err.message}`)
    return defaultScoring()
  }
}

function defaultScoring() {
  return {
    match_score: 50,
    seniority_level: 'Senior Manager',
    company_size: 'scale-up',
    industry: 'Technology',
    salary_estimate_min: null,
    salary_estimate_max: null,
    reasoning: 'Default — scoring unavailable',
  }
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function getExistingUrls() {
  const { data, error } = await supabase.from('jobs').select('url')
  if (error) {
    console.error('Could not load existing URLs:', error.message)
    return new Set()
  }
  return new Set(data.map(r => r.url))
}

async function upsertJobs(jobs) {
  // status and notes are intentionally excluded so they are never overwritten on conflict
  const rows = jobs.map(job => ({
    tab: job.tab,
    title: job.title,
    company: job.company,
    location: job.location,
    url: job.url,
    posted_date: job.postedDate,
    // If Adzuna provided a salary use it (not estimated); otherwise fall back to Claude's estimate
    salary_min: job.salaryMin ?? job.scoring?.salary_estimate_min ?? null,
    salary_max: job.salaryMax ?? job.scoring?.salary_estimate_max ?? null,
    salary_is_estimated: job.salaryMin == null && job.salaryMax == null,
    source: job.source,
    industry: job.scoring?.industry ?? null,
    company_size: job.scoring?.company_size ?? null,
    seniority_level: job.scoring?.seniority_level ?? null,
    reasoning: job.scoring?.reasoning ?? null,
    match_score: job.scoring?.match_score ?? null,
  }))

  const { error } = await supabase
    .from('jobs')
    .upsert(rows, { onConflict: 'url', ignoreDuplicates: false })

  if (error) {
    console.error('Upsert failed:', error.message)
    return false
  }
  console.log(`Upserted ${rows.length} jobs`)
  return true
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== fetch-jobs start', new Date().toISOString(), '===')

  // 1. Adzuna
  const [pmmAdzuna, financeAdzuna] = await Promise.all([
    fetchAdzuna('product marketing director OR head of product marketing', 'pmm'),
    fetchAdzuna('senior controller OR finance manager OR controlling manager', 'finance'),
  ])

  // 2. Career pages
  const scraped = await scrapeAllCareerPages()

  // 3. Deduplicate by URL within this batch
  const allJobs = [...pmmAdzuna, ...financeAdzuna, ...scraped]
  const batchSeen = new Set()
  const unique = allJobs.filter(job => {
    if (!job.url || batchSeen.has(job.url)) return false
    batchSeen.add(job.url)
    return true
  })
  console.log(`Total unique jobs in batch: ${unique.length}`)

  // 4. Skip URLs already in Supabase
  const existingUrls = await getExistingUrls()
  const newJobs = unique.filter(job => !existingUrls.has(job.url))
  console.log(`New jobs to score and insert: ${newJobs.length}`)

  if (newJobs.length === 0) {
    console.log('Nothing new — done.')
    return
  }

  // 5. Score via Claude (5 at a time to stay within rate limits)
  const CONCURRENCY = 5
  for (let i = 0; i < newJobs.length; i += CONCURRENCY) {
    const batch = newJobs.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async job => {
        job.scoring = await scoreJob(job)
        console.log(
          `  scored "${job.title}" @ ${job.company} → ${job.scoring.match_score}/100`,
        )
      }),
    )
    if (i + CONCURRENCY < newJobs.length) await sleep(2000)
  }

  // 6. Upsert
  await upsertJobs(newJobs)

  console.log('=== fetch-jobs done', new Date().toISOString(), '===')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
