#!/usr/bin/env node
/**
 * scripts/send-digest.js
 *
 * Sends a weekly email digest via Resend:
 *   - New jobs in the past 7 days with match_score > 80
 *   - Roles marked "applied" 2–3 weeks ago (follow-up reminder)
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 *   RESEND_API_KEY
 *   DIGEST_EMAIL          — recipient address
 *   FROM_EMAIL            — sender (must be a verified Resend domain)
 */

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const { SUPABASE_URL, SUPABASE_ANON_KEY, RESEND_API_KEY, DIGEST_EMAIL, FROM_EMAIL } = process.env

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { console.error('Missing Supabase env vars'); process.exit(1) }
if (!RESEND_API_KEY) { console.error('Missing RESEND_API_KEY'); process.exit(1) }
if (!DIGEST_EMAIL) { console.error('Missing DIGEST_EMAIL'); process.exit(1) }

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const resend = new Resend(RESEND_API_KEY)
const fromEmail = FROM_EMAIL || 'Job Tracker <digest@yourdomain.com>'

// ── Data queries ──────────────────────────────────────────────────────────────

async function getNewJobs() {
  const since = new Date()
  since.setDate(since.getDate() - 7)

  const { data, error } = await supabase
    .from('jobs')
    .select('tab,title,company,location,url,salary_min,salary_max,salary_is_estimated,match_score,seniority_level,industry,reasoning')
    .gte('created_at', since.toISOString())
    .gte('match_score', 80)
    .order('match_score', { ascending: false })

  if (error) { console.error('getNewJobs failed:', error.message); return [] }
  return data ?? []
}

async function getFollowUpReminders() {
  // Jobs applied 2–3 weeks ago (window for a polite follow-up email)
  const threeWeeksAgo = new Date()
  threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21)
  const twoWeeksAgo = new Date()
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)

  const { data, error } = await supabase
    .from('jobs')
    .select('title,company,url,date_applied,notes')
    .eq('status', 'applied')
    .gte('date_applied', threeWeeksAgo.toISOString().split('T')[0])
    .lte('date_applied', twoWeeksAgo.toISOString().split('T')[0])
    .order('date_applied', { ascending: true })

  if (error) { console.error('getFollowUpReminders failed:', error.message); return [] }
  return data ?? []
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function fmt(min, max, est) {
  if (!min && !max) return ''
  const s = min && max
    ? `€${Math.round(min / 1000)}k – €${Math.round(max / 1000)}k`
    : `€${Math.round((min || max) / 1000)}k+`
  return est ? `~${s}` : s
}

function scoreColor(n) {
  if (n >= 90) return '#16a34a'
  if (n >= 80) return '#d97706'
  return '#ea580c'
}

function jobRow(job) {
  const salary = fmt(job.salary_min, job.salary_max, job.salary_is_estimated)
  const tab = job.tab === 'pmm' ? 'PMM' : 'Finance'
  return `
    <tr style="border-bottom:1px solid #f1f5f9">
      <td style="padding:12px 8px">
        <a href="${job.url}" style="font-weight:600;color:#4f46e5;text-decoration:none">${job.title}</a><br>
        <span style="color:#6b7280;font-size:13px">${job.company} · ${job.location ?? ''}</span>
        ${job.reasoning ? `<br><span style="color:#9ca3af;font-size:12px;font-style:italic">${job.reasoning}</span>` : ''}
      </td>
      <td style="padding:12px 8px;white-space:nowrap;font-size:13px;color:#374151">
        ${salary || '—'}
      </td>
      <td style="padding:12px 8px;text-align:center">
        <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:700;
          background:${scoreColor(job.match_score)}20;color:${scoreColor(job.match_score)}">
          ${job.match_score}%
        </span>
      </td>
      <td style="padding:12px 8px;text-align:center;font-size:12px;color:#6b7280">${tab}</td>
    </tr>`
}

function followUpRow(job) {
  const applied = job.date_applied
    ? new Date(job.date_applied).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : '—'
  return `
    <tr style="border-bottom:1px solid #f1f5f9">
      <td style="padding:12px 8px">
        <a href="${job.url}" style="font-weight:600;color:#4f46e5;text-decoration:none">${job.title}</a><br>
        <span style="color:#6b7280;font-size:13px">${job.company}</span>
        ${job.notes ? `<br><span style="color:#9ca3af;font-size:12px">${job.notes.slice(0, 80)}…</span>` : ''}
      </td>
      <td style="padding:12px 8px;font-size:13px;color:#374151;white-space:nowrap">Applied ${applied}</td>
    </tr>`
}

function buildHtml(newJobs, followUps) {
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  const newSection = newJobs.length > 0 ? `
    <h2 style="margin:32px 0 12px;font-size:16px;color:#111827">
      🆕 New roles this week <span style="color:#6b7280;font-weight:400;font-size:14px">(match ≥ 80%)</span>
    </h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#111827">
      <thead>
        <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0">
          <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;color:#9ca3af">Role</th>
          <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;color:#9ca3af">Salary</th>
          <th style="padding:8px;text-align:center;font-size:11px;text-transform:uppercase;color:#9ca3af">Match</th>
          <th style="padding:8px;text-align:center;font-size:11px;text-transform:uppercase;color:#9ca3af">Tab</th>
        </tr>
      </thead>
      <tbody>${newJobs.map(jobRow).join('')}</tbody>
    </table>` : ''

  const followSection = followUps.length > 0 ? `
    <h2 style="margin:32px 0 12px;font-size:16px;color:#111827">
      ⏰ Follow-up reminders <span style="color:#6b7280;font-weight:400;font-size:14px">(applied 2–3 weeks ago)</span>
    </h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#111827">
      <tbody>${followUps.map(followUpRow).join('')}</tbody>
    </table>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:680px;margin:32px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
    <!-- Header -->
    <div style="background:#4f46e5;padding:24px 32px">
      <h1 style="margin:0;color:white;font-size:20px;font-weight:700">Job Tracker Weekly Digest</h1>
      <p style="margin:4px 0 0;color:#c7d2fe;font-size:14px">${today}</p>
    </div>
    <!-- Body -->
    <div style="padding:24px 32px 32px">
      ${newSection || followSection
        ? newSection + followSection
        : '<p style="color:#6b7280;font-style:italic">Nothing notable this week — check back next Monday.</p>'}

      <div style="margin-top:32px;padding-top:24px;border-top:1px solid #f1f5f9;text-align:center">
        <a href="${process.env.APP_URL || 'https://your-gh-pages-url'}"
           style="display:inline-block;padding:10px 24px;background:#4f46e5;color:white;border-radius:10px;
                  font-size:14px;font-weight:600;text-decoration:none">
          Open Job Tracker →
        </a>
      </div>
    </div>
  </div>
</body>
</html>`
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching digest data…')
  const [newJobs, followUps] = await Promise.all([getNewJobs(), getFollowUpReminders()])
  console.log(`New jobs: ${newJobs.length}, follow-ups: ${followUps.length}`)

  if (newJobs.length === 0 && followUps.length === 0) {
    console.log('Nothing to send — skipping')
    return
  }

  const html = buildHtml(newJobs, followUps)
  const subject = [
    newJobs.length > 0 && `${newJobs.length} new role${newJobs.length > 1 ? 's' : ''}`,
    followUps.length > 0 && `${followUps.length} follow-up${followUps.length > 1 ? 's' : ''}`,
  ].filter(Boolean).join(', ')

  const { data, error } = await resend.emails.send({
    from: fromEmail,
    to: DIGEST_EMAIL,
    subject: `Job Tracker: ${subject}`,
    html,
  })

  if (error) {
    console.error('Send failed:', error)
    process.exit(1)
  }
  console.log('Digest sent:', data?.id)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
