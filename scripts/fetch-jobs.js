#!/usr/bin/env node
/**
 * scripts/fetch-jobs.js
 *
 * 1. Fetches jobs from Adzuna API (PMM + Finance queries, Amsterdam + NL remote)
 * 2. Fetches from JSearch/RapidAPI (LinkedIn + Indeed + Glassdoor)
 * 3. Fetches from Greenhouse JSON API (20+ EU tech companies)
 * 4. Fetches from Lever JSON API (additional EU tech companies)
 * 5. Deduplicates + location-filters (Amsterdam / Netherlands / EU remote only)
 * 6. Scores each new job via Claude API
 * 7. Upserts to Supabase
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 *   ADZUNA_APP_ID, ADZUNA_API_KEY
 *   ANTHROPIC_API_KEY
 * Optional:
 *   RAPIDAPI_KEY  (JSearch — LinkedIn/Indeed/Glassdoor)
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import axios from 'axios'
import { load as cheerioLoad } from 'cheerio'

// ── Config ───────────────────────────────────────────────────────────────────

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  ADZUNA_APP_ID,
  ADZUNA_API_KEY,
  ANTHROPIC_API_KEY,
  RAPIDAPI_KEY,
} = process.env

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

const PMM_KEYWORDS = [
  'product marketing',
  'pmm',
  'product marketer',
  'head of marketing',
  'vp marketing',
  'director of marketing',
]

const FINANCE_KEYWORDS = [
  'controller',
  'finance manager',
  'controlling',
  'financial manager',
  'financial controller',
  'fp&a',
  'financial planning',
  'head of finance',
  'finance director',
  'senior finance',
  'finance business partner',
  'vp finance',
  'chief financial',
]

// ── Location filter ───────────────────────────────────────────────────────────
// Keep only Amsterdam/NL jobs or EU-remote jobs; drop US/UK-only remote

function isRelevantLocation(location) {
  if (!location) return true // unknown → keep
  const l = location.toLowerCase()

  // Amsterdam or Netherlands
  if (l.includes('amsterdam') || l.includes('netherlands') || l.includes('nederland')) return true

  // Other major NL cities
  if (l.includes('utrecht') || l.includes('rotterdam') || l.includes('eindhoven') ||
      l.includes('den haag') || l.includes('the hague') || l.includes('haarlem')) return true

  // EU remote — keep unless it explicitly says US/UK/Canada-only
  if (l.includes('remote')) {
    const nonEuOnly = [
      'united states', 'usa', 'us only', 'us-only',
      'united kingdom', 'uk only', 'uk-only',
      'canada', 'australia', 'latin america',
    ]
    if (nonEuOnly.some(x => l.includes(x))) return false
    return true
  }

  return false
}

// ── Adzuna API ────────────────────────────────────────────────────────────────

async function fetchAdzuna(query, tab, where = 'amsterdam') {
  if (!ADZUNA_APP_ID || !ADZUNA_API_KEY) {
    console.warn('Adzuna credentials not set — skipping')
    return []
  }
  try {
    const params = {
      app_id: ADZUNA_APP_ID,
      app_key: ADZUNA_API_KEY,
      what: query,
      results_per_page: 50,
      sort_by: 'date',
    }
    if (where) params.where = where

    const { data } = await axios.get('https://api.adzuna.com/v1/api/jobs/nl/search/1', {
      params,
      timeout: 30_000,
    })
    const results = data.results ?? []
    console.log(`Adzuna [${tab}/${where || 'NL'}]: ${results.length} results`)
    return results.map(job => ({
      tab,
      title: job.title,
      company: job.company?.display_name ?? 'Unknown',
      location: job.location?.display_name ?? 'Netherlands',
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

// ── JSearch API (RapidAPI) ────────────────────────────────────────────────────
// Covers LinkedIn + Indeed + Glassdoor results in one call

async function fetchJSearch(query, tab) {
  if (!RAPIDAPI_KEY) {
    console.warn('RAPIDAPI_KEY not set — skipping JSearch')
    return []
  }
  try {
    const { data } = await axios.get('https://jsearch.p.rapidapi.com/search', {
      params: {
        query: `${query} Amsterdam Netherlands`,
        page: '1',
        num_pages: '3',
        date_posted: 'month',
      },
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
      },
      timeout: 30_000,
    })
    const results = data.data ?? []
    console.log(`JSearch [${tab}]: ${results.length} results`)
    return results
      .filter(job => {
        const loc = job.job_city
          ? `${job.job_city}, ${job.job_country}`
          : (job.job_country ?? '')
        return isRelevantLocation(loc)
      })
      .map(job => ({
        tab,
        title: job.job_title,
        company: job.employer_name ?? 'Unknown',
        location: job.job_city ? `${job.job_city}, ${job.job_country}` : 'Netherlands',
        url: job.job_apply_link ?? job.job_google_link,
        postedDate: job.job_posted_at_datetime_utc?.split('T')[0] ?? null,
        salaryMin: job.job_min_salary ? Math.round(job.job_min_salary) : null,
        salaryMax: job.job_max_salary ? Math.round(job.job_max_salary) : null,
        description: job.job_description?.slice(0, 600) ?? '',
        source: 'adzuna',
      }))
  } catch (err) {
    console.error(`JSearch [${tab}] failed: ${err.message}`)
    return []
  }
}

// ── Greenhouse JSON API ───────────────────────────────────────────────────────

async function fetchGreenhouse(boardToken, company, tab, keywords) {
  try {
    const { data } = await axios.get(
      `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs`,
      { params: { content: true }, timeout: 15_000 },
    )
    const jobs = (data.jobs ?? [])
      .filter(job => {
        const lower = job.title.toLowerCase()
        const locationOk = isRelevantLocation(job.location?.name)
        return locationOk && keywords.some(kw => lower.includes(kw))
      })
      .map(job => ({
        tab,
        title: job.title,
        company,
        location: job.location?.name ?? 'Netherlands',
        url: job.absolute_url,
        postedDate: job.updated_at?.split('T')[0] ?? null,
        salaryMin: null,
        salaryMax: null,
        description: job.content ? cheerioLoad(job.content).text().slice(0, 600) : '',
        source: 'career_page',
      }))
    if (jobs.length > 0) console.log(`Greenhouse [${company}]: ${jobs.length} matching jobs`)
    return jobs
  } catch (err) {
    // 404 = company doesn't use this Greenhouse token — silent skip
    if (!err.response || err.response.status !== 404) {
      console.warn(`Greenhouse [${boardToken}] failed: ${err.message}`)
    }
    return []
  }
}

// ── Lever JSON API ────────────────────────────────────────────────────────────

async function fetchLever(company, companyName, tab, keywords) {
  try {
    const { data } = await axios.get(
      `https://api.lever.co/v0/postings/${company}?mode=json`,
      { timeout: 15_000 },
    )
    const jobs = (Array.isArray(data) ? data : [])
      .filter(job => {
        const lower = job.text?.toLowerCase() ?? ''
        const locationOk = isRelevantLocation(job.categories?.location ?? job.country ?? '')
        return locationOk && keywords.some(kw => lower.includes(kw))
      })
      .map(job => ({
        tab,
        title: job.text,
        company: companyName,
        location: job.categories?.location ?? 'Netherlands',
        url: job.hostedUrl,
        postedDate: job.createdAt
          ? new Date(job.createdAt).toISOString().split('T')[0]
          : null,
        salaryMin: null,
        salaryMax: null,
        description: job.descriptionPlain?.slice(0, 600) ?? '',
        source: 'career_page',
      }))
    if (jobs.length > 0) console.log(`Lever [${companyName}]: ${jobs.length} matching jobs`)
    return jobs
  } catch (err) {
    if (!err.response || err.response.status !== 404) {
      console.warn(`Lever [${company}] failed: ${err.message}`)
    }
    return []
  }
}

// ── Career page targets ───────────────────────────────────────────────────────

async function scrapeAllCareerPages() {
  const results = []

  // ── Greenhouse boards (Amsterdam HQ / EU remote tech companies) ──
  const greenhouseTargets = [
    // Amsterdam HQ
    { token: 'adyen',         name: 'Adyen' },
    { token: 'mollie',        name: 'Mollie' },
    { token: 'getyourguide',  name: 'GetYourGuide' },
    { token: 'templafy',      name: 'Templafy' },
    { token: 'messagebird',   name: 'MessageBird' },
    { token: 'catawiki',      name: 'Catawiki' },
    { token: 'picnic',        name: 'Picnic' },
    { token: 'takeaway',      name: 'Just Eat Takeaway' },
    { token: 'coolblue',      name: 'Coolblue' },
    { token: 'booking',       name: 'Booking.com' },
    // EU remote-friendly tech
    { token: 'elastic',       name: 'Elastic' },
    { token: 'spotify',       name: 'Spotify' },
    { token: 'klarna',        name: 'Klarna' },
    { token: 'figma',         name: 'Figma' },
    { token: 'miro',          name: 'Miro' },
    { token: 'typeform',      name: 'Typeform' },
    { token: 'personio',      name: 'Personio' },
    { token: 'contentful',    name: 'Contentful' },
    { token: 'n26',           name: 'N26' },
    { token: 'wise',          name: 'Wise' },
    { token: 'sumup',         name: 'SumUp' },
    { token: 'deliveroo',     name: 'Deliveroo' },
    { token: 'stripe',        name: 'Stripe' },
    { token: 'intercom',      name: 'Intercom' },
    { token: 'gitlab',        name: 'GitLab' },
    { token: 'datadog',       name: 'Datadog' },
    { token: 'mongodb',       name: 'MongoDB' },
    { token: 'twilio',        name: 'Twilio' },
    { token: 'semrush',       name: 'Semrush' },
    { token: 'bynder',        name: 'Bynder' },
  ]

  // Fetch all Greenhouse boards in batches of 5 to be polite
  for (let i = 0; i < greenhouseTargets.length; i += 5) {
    const batch = greenhouseTargets.slice(i, i + 5)
    await Promise.all(
      batch.flatMap(({ token, name }) => [
        fetchGreenhouse(token, name, 'pmm', PMM_KEYWORDS).then(r => results.push(...r)),
        fetchGreenhouse(token, name, 'finance', FINANCE_KEYWORDS).then(r => results.push(...r)),
      ]),
    )
    await sleep(500)
  }

  // ── Lever boards ──
  const leverTargets = [
    { company: 'wetransfer',  name: 'WeTransfer' },
    { company: 'catawiki',    name: 'Catawiki' },
    { company: 'messagebird', name: 'MessageBird' },
    { company: 'otrium',      name: 'Otrium' },
    { company: 'sendcloud',   name: 'Sendcloud' },
    { company: 'lightyear',   name: 'Lightyear' },
    { company: 'travix',      name: 'Travix' },
    { company: 'fairphone',   name: 'Fairphone' },
    { company: 'messagebird', name: 'MessageBird' },
  ]

  for (let i = 0; i < leverTargets.length; i += 5) {
    const batch = leverTargets.slice(i, i + 5)
    await Promise.all(
      batch.flatMap(({ company, name }) => [
        fetchLever(company, name, 'pmm', PMM_KEYWORDS).then(r => results.push(...r)),
        fetchLever(company, name, 'finance', FINANCE_KEYWORDS).then(r => results.push(...r)),
      ]),
    )
    await sleep(500)
  }

  // ── HTML scraping fallback for companies not on Greenhouse/Lever ──
  const htmlTargets = [
    { url: 'https://careers.adyen.com/vacancies', company: 'Adyen', tabs: ['pmm', 'finance'] },
    { url: 'https://jobs.booking.com/jobs', company: 'Booking.com', tabs: ['pmm', 'finance'] },
    { url: 'https://www.asml.com/en/careers/find-your-job', company: 'ASML', tabs: ['finance'] },
    { url: 'https://careers.takeaway.com/global/en', company: 'Just Eat Takeaway', tabs: ['pmm', 'finance'] },
    { url: 'https://jobs.picnic.app', company: 'Picnic', tabs: ['finance'] },
    { url: 'https://www.ing.jobs/netherlands', company: 'ING', tabs: ['finance'] },
    { url: 'https://careers.abn.nl/en', company: 'ABN AMRO', tabs: ['finance'] },
    { url: 'https://www.philips.com/a-w/careers/jobs.html', company: 'Philips', tabs: ['pmm', 'finance'] },
    { url: 'https://jobs.tomtom.com', company: 'TomTom', tabs: ['pmm', 'finance'] },
    { url: 'https://careers.wehkamp.com', company: 'Wehkamp', tabs: ['pmm', 'finance'] },
  ]

  for (const { url, company, tabs } of htmlTargets) {
    for (const tab of tabs) {
      const kw = tab === 'pmm' ? PMM_KEYWORDS : FINANCE_KEYWORDS
      results.push(...(await scrapeCareerPage(url, company, tab, kw)))
    }
    await sleep(800)
  }

  return results
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

    if (found.length > 0) console.log(`Scraped [${company}]: ${found.length} matching jobs`)
    return found
  } catch (err) {
    console.warn(`Scrape [${company}] failed: ${err.message}`)
    return []
  }
}

// ── Title pre-filter ─────────────────────────────────────────────────────────
// Skip scoring entirely if the title doesn't contain a seniority signal

const TITLE_KEYWORDS = {
  pmm:     ['head of', 'director', 'senior manager', 'vp ', 'vice president'],
  finance: ['manager', 'head of', 'controller', 'director', 'vp ', 'vice president'],
}

function isTitleRelevant(title, tab) {
  const lower = title.toLowerCase()
  return TITLE_KEYWORDS[tab]?.some(kw => lower.includes(kw)) ?? true
}

// ── Company metadata lookup ───────────────────────────────────────────────────
// Hardcoded so we don't burn Claude tokens on well-known companies

const COMPANY_LOOKUP = {
  'netflix':        { industry: 'Streaming & Entertainment', company_size: 'enterprise' },
  'uber':           { industry: 'Mobility & Delivery Tech',  company_size: 'enterprise' },
  'booking.com':    { industry: 'Travel Tech',               company_size: 'enterprise' },
  'booking':        { industry: 'Travel Tech',               company_size: 'enterprise' },
  'adyen':          { industry: 'Fintech / Payments',        company_size: 'enterprise' },
  'mollie':         { industry: 'Fintech / Payments',        company_size: 'scale-up'   },
  'justeat':        { industry: 'Food Delivery Tech',        company_size: 'enterprise' },
  'just eat':       { industry: 'Food Delivery Tech',        company_size: 'enterprise' },
  'takeaway':       { industry: 'Food Delivery Tech',        company_size: 'enterprise' },
  'backbase':       { industry: 'Fintech / Banking Tech',    company_size: 'scale-up'   },
  'spotify':        { industry: 'Streaming & Entertainment', company_size: 'enterprise' },
  'klarna':         { industry: 'Fintech / Payments',        company_size: 'enterprise' },
  'wise':           { industry: 'Fintech / Payments',        company_size: 'scale-up'   },
  'stripe':         { industry: 'Fintech / Payments',        company_size: 'enterprise' },
  'figma':          { industry: 'Design & Collaboration',    company_size: 'enterprise' },
  'miro':           { industry: 'Design & Collaboration',    company_size: 'scale-up'   },
  'elastic':        { industry: 'Enterprise Software',       company_size: 'enterprise' },
  'datadog':        { industry: 'DevOps & Observability',    company_size: 'enterprise' },
  'gitlab':         { industry: 'DevOps & Developer Tools',  company_size: 'enterprise' },
  'mongodb':        { industry: 'Database & Cloud',          company_size: 'enterprise' },
  'contentful':     { industry: 'CMS & Content Platform',    company_size: 'scale-up'   },
  'personio':       { industry: 'HR Tech',                   company_size: 'scale-up'   },
  'typeform':       { industry: 'SaaS / No-code',            company_size: 'scale-up'   },
  'getyourguide':   { industry: 'Travel Tech',               company_size: 'scale-up'   },
  'picnic':         { industry: 'Grocery & Delivery Tech',   company_size: 'scale-up'   },
  'catawiki':       { industry: 'E-commerce / Marketplace',  company_size: 'scale-up'   },
  'wetransfer':     { industry: 'SaaS / File Sharing',       company_size: 'scale-up'   },
  'bynder':         { industry: 'Digital Asset Management',  company_size: 'scale-up'   },
  'messagebird':    { industry: 'Communications Platform',   company_size: 'scale-up'   },
  'bird':           { industry: 'Communications Platform',   company_size: 'scale-up'   },
  'coolblue':       { industry: 'E-commerce / Retail',       company_size: 'enterprise' },
  'sumup':          { industry: 'Fintech / Payments',        company_size: 'scale-up'   },
  'n26':            { industry: 'Fintech / Neobank',         company_size: 'scale-up'   },
  'deliveroo':      { industry: 'Food Delivery Tech',        company_size: 'enterprise' },
  'intercom':       { industry: 'Customer Engagement SaaS',  company_size: 'scale-up'   },
  'semrush':        { industry: 'MarTech / SEO',             company_size: 'scale-up'   },
  'twilio':         { industry: 'Communications Platform',   company_size: 'enterprise' },
}

function lookupCompany(companyName) {
  const lower = companyName.toLowerCase()
  for (const [key, meta] of Object.entries(COMPANY_LOOKUP)) {
    if (lower.includes(key)) return meta
  }
  return null
}

// ── Batch Claude scoring (one API call per tab) ───────────────────────────────

const PMM_SYSTEM = `You are scoring job fit for a senior Product Marketing leader. Background: 10+ years in product marketing and GTM. Previously at Booking.com (drove payments adoption 3K→1M properties, tripled app revenue) and Decathlon (ecommerce, loyalty, B2C apps). Expert in go-to-market strategy, product launches, and cross-functional leadership. Based in Amsterdam. Target: Director or Head-of level PMM roles.`

const FINANCE_SYSTEM = `You are scoring job fit for a senior Finance professional. Background: finance leadership with strong analytical and commercial acumen. Experience in controlling, FP&A, and business partnering in tech/scale-up environments. Based in Amsterdam.`

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

async function scoreJobsBatch(jobs) {
  if (!anthropic) {
    console.warn('ANTHROPIC_API_KEY not set — using defaults')
    jobs.forEach(job => { job.scoring = defaultScoring() })
    return
  }

  // Group by tab
  const byTab = { pmm: [], finance: [] }
  jobs.forEach((job, idx) => byTab[job.tab]?.push({ job, idx }))

  for (const [tab, entries] of Object.entries(byTab)) {
    if (entries.length === 0) continue

    const system = tab === 'pmm' ? PMM_SYSTEM : FINANCE_SYSTEM
    const jobLines = entries
      .map(({ job }, i) => {
        const snippet = (job.description || '').slice(0, 150).replace(/\s+$/, '')
        return `${i + 1}. "${job.title}" at ${job.company} — ${snippet || 'No description'}`
      })
      .join('\n')

    const userMsg = `Score each job. Return ONLY a JSON array, no markdown, no explanation.

Jobs:
${jobLines}

Return: [{"index":1,"match_score":0-100,"seniority_level":"Director|Head of|Senior Manager|Manager|Controller","salary_estimate_min":number_or_null,"salary_estimate_max":number_or_null,"reasoning":"1 sentence"}]`

    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: userMsg }],
      })
      const text = response.content[0].text
      const jsonStr = text.match(/\[[\s\S]*\]/)?.[0]
      const results = JSON.parse(jsonStr)

      results.forEach(result => {
        const entry = entries[result.index - 1]
        if (!entry) return
        const companyMeta = lookupCompany(entry.job.company)
        entry.job.scoring = {
          match_score: result.match_score,
          seniority_level: result.seniority_level,
          salary_estimate_min: result.salary_estimate_min ?? null,
          salary_estimate_max: result.salary_estimate_max ?? null,
          reasoning: result.reasoning ?? '',
          industry: companyMeta?.industry ?? 'Technology',
          company_size: companyMeta?.company_size ?? 'scale-up',
        }
        console.log(`  scored "${entry.job.title}" @ ${entry.job.company} → ${result.match_score}/100`)
      })

      // Fallback for any jobs not returned in response
      entries.forEach(({ job }) => {
        if (!job.scoring) job.scoring = defaultScoring()
      })
    } catch (err) {
      console.error(`Batch scoring [${tab}] failed: ${err.message}`)
      entries.forEach(({ job }) => { job.scoring = defaultScoring() })
    }
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

  // 1. Adzuna (Amsterdam) + Adzuna (NL-wide remote) + JSearch — all in parallel
  const [
    pmmAdzunaAms, financeAdzunaAms,
    pmmAdzunaNL, financeAdzunaNL,
    pmmJSearch, financeJSearch,
  ] = await Promise.all([
    fetchAdzuna('product marketing manager OR head of product marketing OR director product marketing', 'pmm', 'amsterdam'),
    fetchAdzuna('finance manager OR financial controller OR head of finance OR FP&A', 'finance', 'amsterdam'),
    fetchAdzuna('product marketing manager OR head of product marketing', 'pmm', null),
    fetchAdzuna('finance manager OR financial controller OR head of finance', 'finance', null),
    fetchJSearch('head of product marketing OR VP product marketing OR director product marketing', 'pmm'),
    fetchJSearch('senior financial controller OR finance manager OR FP&A manager', 'finance'),
  ])

  // 2. Career pages (Greenhouse + Lever + HTML scraping)
  const scraped = await scrapeAllCareerPages()

  // 3. Merge + location-filter + deduplicate by URL
  const allJobs = [
    ...pmmAdzunaAms, ...financeAdzunaAms,
    ...pmmAdzunaNL, ...financeAdzunaNL,
    ...pmmJSearch, ...financeJSearch,
    ...scraped,
  ].filter(job => isRelevantLocation(job.location))

  const batchSeen = new Set()
  const unique = allJobs.filter(job => {
    if (!job.url || batchSeen.has(job.url)) return false
    batchSeen.add(job.url)
    return true
  })
  console.log(`Total unique relevant jobs in batch: ${unique.length}`)

  // 4. Skip URLs already in Supabase (dedup BEFORE scoring)
  const existingUrls = await getExistingUrls()
  const newJobs = unique.filter(job => !existingUrls.has(job.url))
  console.log(`New jobs after dedup: ${newJobs.length}`)

  if (newJobs.length === 0) {
    console.log('Nothing new — done.')
    return
  }

  // 5. Title pre-filter — drop jobs that don't match seniority keywords
  const scoringCandidates = newJobs.filter(job => isTitleRelevant(job.title, job.tab))
  const skipped = newJobs.length - scoringCandidates.length
  if (skipped > 0) console.log(`Title filter: skipped ${skipped} junior/irrelevant titles`)

  // Assign default scoring to filtered-out jobs so they still get upserted (low score)
  newJobs
    .filter(job => !isTitleRelevant(job.title, job.tab))
    .forEach(job => { job.scoring = { ...defaultScoring(), match_score: 20 } })

  // 6. Batch score via Claude Haiku — one API call per tab
  await scoreJobsBatch(scoringCandidates)

  // 7. Upsert all (scored + default-scored)
  await upsertJobs(newJobs)

  console.log('=== fetch-jobs done', new Date().toISOString(), '===')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
