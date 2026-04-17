#!/usr/bin/env node
/**
 * scripts/send-daily-summary.js
 *
 * Sends a daily email after fetch-jobs.js completes.
 * Mirrors the hard filter rules in App.tsx so counts match what the UI shows.
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 *   RESEND_API_KEY
 *   DIGEST_EMAIL  — recipient
 *   FROM_EMAIL    — sender (verified Resend domain)
 * Optional:
 *   APP_URL       — link in footer
 */

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const { SUPABASE_URL, SUPABASE_ANON_KEY, RESEND_API_KEY, DIGEST_EMAIL, FROM_EMAIL, APP_URL } = process.env

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { console.error('Missing Supabase vars'); process.exit(1) }
if (!RESEND_API_KEY) { console.error('Missing RESEND_API_KEY'); process.exit(1) }
if (!DIGEST_EMAIL) { console.error('Missing DIGEST_EMAIL'); process.exit(1) }

// ── Mirror hard filter rules from App.tsx ──────────────────────────────────────

const SALARY_CAP = { pmm: 120_000, finance: 95_000 }
const PMM_LEADERSHIP_KW = ['head of', 'director', 'vp ', 'vice president', 'cmo', 'chief marketing', 'principal', 'staff product marketing', 'product marketing lead']
const PMM_EXCEPTION_COS = new Set(['booking.com', 'uber'])
const FINANCE_OK_KW = ['controller', 'controlling', 'accounting', 'accountant', 'finance manager', 'accounting manager']
const FINANCE_EXCL_KW = ['fp&a', 'financial planning', 'strategic finance', 'financial planning and analysis']

function hardFilterCode(job) {
  const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  if (job.posted_date && new Date(job.posted_date) < sevenDaysAgo) return 'EXPIRED_7D'
  const cap = SALARY_CAP[job.tab]
  if (job.salary_max && !job.salary_is_estimated && job.salary_max > cap) return 'SALARY_OVER_CAP'
  if (job.tab === 'pmm') {
    const t = (job.title || '').toLowerCase()
    const passes = PMM_LEADERSHIP_KW.some(kw => t.includes(kw)) ||
      (PMM_EXCEPTION_COS.has((job.company || '').toLowerCase()) && t.includes('senior'))
    if (!passes) return 'PMM_NOT_LEADERSHIP'
  }
  if (job.tab === 'finance') {
    const t = (job.title || '').toLowerCase()
    if (FINANCE_EXCL_KW.some(kw => t.includes(kw))) return 'FINANCE_FPANDA'
    if (!FINANCE_OK_KW.some(kw => t.includes(kw))) return 'FINANCE_NOT_ACCOUNTING_CTRL'
  }
  return null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtSalary(min, max, est) {
  if (!min && !max) return ''
  const s = min && max
    ? `€${Math.round(min / 1000)}k–€${Math.round(max / 1000)}k`
    : `€${Math.round((min || max) / 1000)}k+`
  return est ? `~${s}` : s
}

function scoreChip(n) {
  const color = n >= 90 ? '#16a34a' : n >= 75 ? '#d97706' : '#6b7280'
  return `<span style="display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:700;background:${color}20;color:${color}">${n}%</span>`
}

function roleRow(job) {
  const salary = fmtSalary(job.salary_min, job.salary_max, job.salary_is_estimated)
  const tab = job.tab === 'pmm' ? 'PMM' : 'Fin'
  return `<tr style="border-bottom:1px solid #f1f5f9">
    <td style="padding:10px 8px">
      <a href="${job.url}" style="font-weight:600;color:#4f46e5;text-decoration:none">${job.title}</a><br>
      <span style="color:#6b7280;font-size:12px">${job.company} · ${job.location ?? ''}</span>
    </td>
    <td style="padding:10px 8px;font-size:12px;white-space:nowrap;color:#374151">${salary || '—'}</td>
    <td style="padding:10px 8px;text-align:center">${scoreChip(job.match_score ?? 0)}</td>
    <td style="padding:10px 8px;text-align:center;font-size:11px;color:#9ca3af">${tab}</td>
  </tr>`
}

// ── HTML builder ───────────────────────────────────────────────────────────────

function buildHtml({ newToday, kept, counts, topRoles }) {
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const appUrl = APP_URL || 'https://aijuldam.github.io/job-tracker/'

  const statCell = (label, value, color = '#111827') =>
    `<td style="text-align:center;padding:12px 16px">
      <div style="font-size:24px;font-weight:700;color:${color}">${value}</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:2px">${label}</div>
    </td>`

  const rolesSection = topRoles.length > 0 ? `
    <h2 style="margin:28px 0 10px;font-size:15px;color:#111827">Top active roles</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0">
          <th style="padding:7px 8px;text-align:left;font-size:10px;text-transform:uppercase;color:#9ca3af">Role</th>
          <th style="padding:7px 8px;text-align:left;font-size:10px;text-transform:uppercase;color:#9ca3af">Salary</th>
          <th style="padding:7px 8px;text-align:center;font-size:10px;text-transform:uppercase;color:#9ca3af">Match</th>
          <th style="padding:7px 8px;text-align:center;font-size:10px;text-transform:uppercase;color:#9ca3af">Tab</th>
        </tr>
      </thead>
      <tbody>${topRoles.map(roleRow).join('')}</tbody>
    </table>` : `<p style="color:#9ca3af;font-style:italic;margin-top:28px">No active roles matching filters today.</p>`

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:640px;margin:28px auto;background:white;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
    <div style="background:#4f46e5;padding:20px 28px">
      <h1 style="margin:0;color:white;font-size:18px;font-weight:700">Job Tracker · Daily Update</h1>
      <p style="margin:3px 0 0;color:#c7d2fe;font-size:13px">${date}</p>
    </div>
    <div style="padding:20px 28px 28px">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f8fafc;border-radius:10px;overflow:hidden;margin-bottom:4px">
        <tr>
          ${statCell('Total in DB', counts.total)}
          ${statCell('New today', newToday, newToday > 0 ? '#4f46e5' : '#111827')}
          ${statCell('Active (≤7d)', kept)}
          ${statCell('Aged out', counts.expired, counts.expired > 0 ? '#ea580c' : '#111827')}
        </tr>
      </table>
      <p style="margin:6px 0 0;font-size:11px;color:#9ca3af">
        Excluded today — salary over cap: ${counts.salaryCap} &nbsp;·&nbsp; seniority/scope: ${counts.seniorityScope}
      </p>
      ${rolesSection}
      <div style="margin-top:24px;padding-top:20px;border-top:1px solid #f1f5f9;text-align:center">
        <a href="${appUrl}" style="display:inline-block;padding:9px 22px;background:#4f46e5;color:white;border-radius:9px;font-size:13px;font-weight:600;text-decoration:none">Open Job Tracker →</a>
      </div>
    </div>
  </div>
</body>
</html>`
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const resend = new Resend(RESEND_API_KEY)

  const { data: allJobs, error } = await supabase
    .from('jobs')
    .select('*')
    .order('match_score', { ascending: false })

  if (error) { console.error('Supabase fetch failed:', error.message); process.exit(1) }

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const newToday = (allJobs ?? []).filter(j => new Date(j.created_at) >= todayStart).length

  const counts = { total: allJobs.length, expired: 0, salaryCap: 0, seniorityScope: 0 }
  const keptJobs = []

  for (const job of allJobs ?? []) {
    const code = hardFilterCode(job)
    if (!code) {
      keptJobs.push(job)
    } else if (code === 'EXPIRED_7D') {
      counts.expired++
    } else if (code === 'SALARY_OVER_CAP') {
      counts.salaryCap++
    } else {
      counts.seniorityScope++
    }
  }

  const topRoles = keptJobs.slice(0, 8)

  console.log(`Total: ${counts.total} | New today: ${newToday} | Active: ${keptJobs.length} | Expired: ${counts.expired} | Salary cap: ${counts.salaryCap} | Seniority: ${counts.seniorityScope}`)

  const html = buildHtml({ newToday, kept: keptJobs.length, counts, topRoles })
  const subject = newToday > 0
    ? `Job Tracker: ${newToday} new role${newToday > 1 ? 's' : ''} · ${keptJobs.length} active`
    : `Job Tracker: ${keptJobs.length} active roles · no new today`

  const { data, error: sendErr } = await resend.emails.send({
    from: FROM_EMAIL || 'Job Tracker <digest@yourdomain.com>',
    to: DIGEST_EMAIL,
    subject,
    html,
  })

  if (sendErr) { console.error('Send failed:', sendErr); process.exit(1) }
  console.log('Daily summary sent:', data?.id)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
