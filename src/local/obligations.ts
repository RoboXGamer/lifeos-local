import { nanoid } from "nanoid";
import { z } from "zod";
import { data } from "./store";
import { run, select } from "./db";
import { dateOnly, requireWorkspace, type CreateItem } from "./templates";
import type { Id } from "./types";

export interface EngagementDoc { _id: string; workspaceId: string; client: string; name: string; createdAt: number }
export interface ObligationDocument { _id: string; workspaceId: string; engagementId: string; label: string; kind: string; body: string; contentHash: string; version: number; supersedesId: string | null; createdAt: number }
export interface CommitmentDoc { _id: string; workspaceId: string; engagementId: string; documentId: string; title: string; party: string; kind: "payment" | "deliverable" | "confirmation"; amountMinor: number | null; currency: string | null; dueDate: string | null; conditions: string; quote: string; quoteStart: number; status: "draft" | "accepted" | "superseded" | "cancelled"; supersedesId: string | null; itemId: string | null; confidence: number; createdAt: number; updatedAt: number }
export interface InvoiceDoc { _id: string; workspaceId: string; engagementId: string; documentId: string | null; reference: string; amountMinor: number; currency: string; dueDate: string | null; state: "issued" | "cancelled"; createdAt: number }
export interface PaymentDoc { _id: string; workspaceId: string; engagementId: string; reference: string; amountMinor: number; currency: string; date: string; kind: "receipt" | "refund"; receiptId: string | null; itemId: string; createdAt: number }
export interface AllocationDoc { _id: string; workspaceId: string; paymentId: string; invoiceId: string; amountMinor: number }
export interface ObligationException { key: string; title: string; detail: string; sourceIds: string[]; commitmentId?: string; invoiceId?: string }
type Scope = { workspaceId: Id<"workspaces">; engagementId: string };
const nameSchema = z.string().trim().min(1).max(160);
const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);
export function currencyDecimals(currency: string): number { return new Intl.NumberFormat("en", { style: "currency", currency: currencySchema.parse(currency) }).resolvedOptions().maximumFractionDigits ?? 2; }
export function parseMoney(value: string, currency: string): number {
  const decimals = currencyDecimals(currency);
  const clean = value.trim().replaceAll(",", "");
  if (!/^\d+(?:\.\d+)?$/.test(clean)) throw new Error("Enter a positive decimal amount without a currency symbol.");
  const [whole, fraction = ""] = clean.split(".");
  if (fraction.slice(decimals).replaceAll("0", "")) throw new Error(`${currency} supports ${decimals} decimal places.`);
  const minor = BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction.slice(0, decimals).padEnd(decimals, "0")) || "0");
  if (minor > 9000000000000n) throw new Error("Amount is too large.");
  return Number(minor);
}
export function formatMoney(amountMinor: number, currency: string): string { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountMinor / 10 ** currencyDecimals(currency)); }
export function listEngagements(args: { workspaceId: string }): EngagementDoc[] { return data.engagements.filter(e => e.workspaceId === args.workspaceId); }
function engagement(args: Scope): EngagementDoc {
  requireWorkspace(args.workspaceId);
  const value = data.engagements.find(e => e._id === args.engagementId && e.workspaceId === args.workspaceId);
  if (!value) throw new Error("Engagement not found in this Workspace.");
  return value;
}
export function obligationDetails(args: Scope) {
  const client = engagement(args);
  const documents = data.obligationDocuments.filter(d => d.engagementId === client._id && d.workspaceId === args.workspaceId);
  const commitments = data.commitments.filter(d => d.engagementId === client._id && d.workspaceId === args.workspaceId);
  const invoices = data.obligationInvoices.filter(d => d.engagementId === client._id && d.workspaceId === args.workspaceId).map(invoice => {
    const allocatedMinor = data.paymentAllocations.filter(a => a.invoiceId === invoice._id && a.workspaceId === args.workspaceId).reduce((sum, a) => sum + a.amountMinor * (data.obligationPayments.find(p => p._id === a.paymentId)?.kind === "refund" ? -1 : 1), 0);
    return { ...invoice, allocatedMinor, outstandingMinor: invoice.amountMinor - allocatedMinor };
  });
  const payments = data.obligationPayments.filter(p => p.engagementId === client._id && p.workspaceId === args.workspaceId).map(payment => ({ ...payment, unallocatedMinor: payment.amountMinor - data.paymentAllocations.filter(a => a.paymentId === payment._id).reduce((sum, a) => sum + a.amountMinor, 0) }));
  const totals = [...new Set(invoices.filter(i => i.state === "issued").map(i => i.currency))].map(currency => ({ currency, invoicedMinor: invoices.filter(i => i.currency === currency && i.state === "issued").reduce((s, i) => s + i.amountMinor, 0), outstandingMinor: invoices.filter(i => i.currency === currency && i.state === "issued").reduce((s, i) => s + i.outstandingMinor, 0) }));
  const exceptions: ObligationException[] = [];
  const current = commitments.filter(c => c.status === "draft" || c.status === "accepted");
  for (let i = 0; i < current.length; i++) for (let j = i + 1; j < current.length; j++) {
    const a = current[i], b = current[j];
    if (a.documentId === b.documentId || a.kind !== b.kind || a.party.toLowerCase() !== b.party.toLowerCase()) continue;
    const differences = [a.amountMinor !== null && b.amountMinor !== null && a.amountMinor !== b.amountMinor ? "amount" : "", a.currency && b.currency && a.currency !== b.currency ? "currency" : "", a.dueDate && b.dueDate && a.dueDate !== b.dueDate ? "deadline" : "", a.conditions && b.conditions && a.conditions !== b.conditions ? "scope or terms" : ""].filter(Boolean);
    if (differences.length) exceptions.push({ key: `conflict:${[a._id, b._id].sort().join(":")}`, title: `Review conflicting ${differences.join(", ")}`, detail: `“${a.title}” and “${b.title}” have competing terms. Draft terms need confirmation; the newest document is not automatically authoritative.`, sourceIds: [a.documentId, b.documentId] });
  }
  for (const invoice of invoices.filter(i => i.state === "issued")) {
    if (invoice.dueDate && invoice.dueDate < new Date().toLocaleDateString("en-CA") && invoice.outstandingMinor > 0) exceptions.push({ key: `overdue:${invoice._id}`, title: `Payment overdue: ${invoice.reference}`, detail: `${formatMoney(invoice.outstandingMinor, invoice.currency)} outstanding since ${invoice.dueDate}.`, sourceIds: invoice.documentId ? [invoice.documentId] : [], invoiceId: invoice._id });
  }
  for (const total of totals) {
    const accepted = current.filter(c => c.status === "accepted" && c.kind === "payment" && c.currency === total.currency && c.amountMinor !== null);
    const promised = accepted.reduce((sum, c) => sum + c.amountMinor!, 0);
    if (accepted.length && promised !== total.invoicedMinor) exceptions.push({ key: `invoice-terms:${client._id}:${total.currency}:${promised}:${total.invoicedMinor}`, title: "Review invoice against accepted payment terms", detail: `Accepted terms total ${formatMoney(promised, total.currency)}; issued invoices total ${formatMoney(total.invoicedMinor, total.currency)}. Check deposits, milestones, and scope before treating this as an error.`, sourceIds: accepted.map(c => c.documentId) });
  }
  for (const payment of payments.filter(p => p.unallocatedMinor > 0)) exceptions.push({ key: `unallocated:${payment._id}`, title: `Match ${payment.reference} to an invoice`, detail: `${formatMoney(payment.unallocatedMinor, payment.currency)} remains unallocated.`, sourceIds: [] });
  for (const payment of payments) {
    const item = data.items.find(i => i._id === payment.itemId && i.workspaceId === args.workspaceId);
    const expectedType = payment.kind === "refund" ? "Expense" : "Income";
    const expectedState = payment.kind === "refund" ? "Spent" : "Received";
    if (!item || item.archived || item.type !== expectedType || item.financialState !== expectedState || item.amount !== payment.amountMinor / 10 ** currencyDecimals(payment.currency)) exceptions.push({ key: `payment-record:${payment._id}:${item?.updatedAt ?? "missing"}`, title: `Review changed financial item: ${payment.reference}`, detail: `The ledger retains the confirmed ${payment.kind} of ${formatMoney(payment.amountMinor, payment.currency)}, but its linked financial item is missing, archived, or has different fields. Reconcile the evidence before changing recorded money.`, sourceIds: [] });
  }
  const timeline = [...documents.map(d => ({ date: d.createdAt, title: `${d.label} · version ${d.version}`, sourceId: d._id })), ...commitments.filter(c => c.status !== "draft").map(c => ({ date: c.updatedAt, title: `${c.status}: ${c.title}`, sourceId: c.documentId })), ...payments.map(p => ({ date: p.createdAt, title: `${p.kind}: ${p.reference} · ${formatMoney(p.amountMinor, p.currency)}`, sourceId: "" }))].sort((a, b) => a.date - b.date);
  return { engagement: client, documents, commitments, invoices, payments, totals, exceptions, timeline };
}

let pdfExtractor: ((bytes: Uint8Array) => Promise<string>) | undefined;
export function setObligationPdfExtractor(extractor: NonNullable<typeof pdfExtractor>) { pdfExtractor = extractor; }
async function hash(text: string): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(v => v.toString(16).padStart(2, "0")).join(""); }
function moneyFromText(text: string): { amountMinor: number | null; currency: string | null } {
  const match = text.match(/(INR|USD|EUR|GBP|JPY|CAD|AUD|AED|SGD|₹|\$|€|£)\s*([\d,]+(?:\.\d+)?)/i);
  if (!match) return { amountMinor: null, currency: null };
  const currency = ({ "₹": "INR", "$": "USD", "€": "EUR", "£": "GBP" } as Record<string, string>)[match[1]] ?? match[1].toUpperCase();
  try { return { amountMinor: parseMoney(match[2], currency), currency }; } catch { return { amountMinor: null, currency: null }; }
}
export function createObligations(createItem: CreateItem) {
  const create = async (args: { workspaceId: Id<"workspaces">; client: string; name: string }) => {
    requireWorkspace(args.workspaceId); const id = nanoid();
    await run("INSERT INTO engagements VALUES (?,?,?,?,?)", [id, args.workspaceId, nameSchema.parse(args.client), nameSchema.parse(args.name), Date.now()]); return id;
  };
  const addDocument = async (args: Scope & { label: string; kind: string; body?: string; pdfBase64?: string; supersedesId?: string }) => {
    engagement(args);
    const kind = z.enum(["quotation", "contract", "email", "invoice", "payment", "other"]).parse(args.kind);
    let body = args.body ?? "";
    if (args.pdfBase64) {
      if (!pdfExtractor) throw new Error("PDF extraction is unavailable in this service build.");
      if (args.pdfBase64.length > 14000000) throw new Error("PDF files must be under 10 MB.");
      const bytes = Uint8Array.from(atob(args.pdfBase64), c => c.charCodeAt(0));
      body = await pdfExtractor(bytes);
    }
    body = z.string().trim().min(1, "No readable text. Paste text from scanned documents.").max(200000).parse(body);
    const contentHash = await hash(body);
    const [duplicate] = await select<{ _id: string }>("SELECT _id FROM obligationDocuments WHERE engagementId=? AND kind=? AND contentHash=?", [args.engagementId, kind, contentHash]);
    if (duplicate) return duplicate._id;
    let version = 1;
    if (args.supersedesId) {
      const [old] = await select<ObligationDocument>("SELECT * FROM obligationDocuments WHERE _id=? AND workspaceId=? AND engagementId=?", [args.supersedesId, args.workspaceId, args.engagementId]);
      if (!old) throw new Error("Previous source not found."); version = old.version + 1;
    }
    const id = nanoid(); await run("INSERT INTO obligationDocuments VALUES (?,?,?,?,?,?,?,?,?,?)", [id, args.workspaceId, args.engagementId, nameSchema.parse(args.label), kind, body, contentHash, version, args.supersedesId ?? null, Date.now()]); return id;
  };
  const extract = async (args: Scope & { documentId: string }) => {
    const client = engagement(args);
    const [doc] = await select<ObligationDocument>("SELECT * FROM obligationDocuments WHERE _id=? AND workspaceId=? AND engagementId=?", [args.documentId, args.workspaceId, args.engagementId]);
    if (!doc) throw new Error("Source document not found.");
    let offset = 0, count = 0;
    for (const line of doc.body.split("\n")) {
      const start = offset; offset += line.length + 1;
      if (!line.trim() || !/pay|deposit|invoice|deliver|scope|confirm|book|due|refund|₹|\$|\b(?:INR|USD|EUR|GBP)\b/i.test(line)) continue;
      if (++count > 100) break;
      const money = moneyFromText(line); const rawDate = line.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]; let dueDate: string | null = null;
      try { if (rawDate) dueDate = dateOnly(rawDate); } catch { /* Ambiguous/invalid dates stay unknown. */ }
      const kind = /pay|deposit|invoice|refund|₹|\$|\b(?:INR|USD|EUR|GBP)\b/i.test(line) ? "payment" : /confirm|book/i.test(line) ? "confirmation" : "deliverable";
      const now = Date.now();
      await run("INSERT OR IGNORE INTO commitments VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [nanoid(), args.workspaceId, args.engagementId, doc._id, line.trim().slice(0, 160), client.client, kind, money.amountMinor, money.currency, dueDate, line.trim(), line, start, "draft", null, null, money.amountMinor !== null && dueDate ? .8 : .5, now, now]);
    }
    return count;
  };
  const review = async (args: Scope & { commitmentId: string; status: "accepted" | "cancelled"; title?: string; party?: string; amount?: string; currency?: string; dueDate?: string | null; conditions?: string; supersedesId?: string }) => {
    engagement(args);
    const [old] = await select<CommitmentDoc>("SELECT * FROM commitments WHERE _id=? AND workspaceId=? AND engagementId=?", [args.commitmentId, args.workspaceId, args.engagementId]);
    if (!old) throw new Error("Commitment not found.");
    const status = z.enum(["accepted", "cancelled"]).parse(args.status);
    if (old.status === "superseded") throw new Error("This commitment was superseded. Review its amendment instead.");
    const currency = args.currency ? currencySchema.parse(args.currency) : old.currency;
    const amountMinor = args.amount !== undefined && args.amount !== "" ? parseMoney(args.amount, currency ?? "INR") : old.amountMinor;
    if (amountMinor !== null && !currency) throw new Error("Choose a currency for this amount.");
    const dueDate = args.dueDate === undefined ? old.dueDate : args.dueDate ? dateOnly(args.dueDate) : null;
    if (args.supersedesId) {
      const [previous] = await select<CommitmentDoc>("SELECT * FROM commitments WHERE _id=? AND workspaceId=? AND engagementId=?", [args.supersedesId, args.workspaceId, args.engagementId]);
      if (!previous || previous._id === old._id || previous.kind !== old.kind || previous.status !== "accepted" || status !== "accepted") throw new Error("Choose an accepted commitment of the same kind to replace.");
      await run("UPDATE commitments SET status='superseded',updatedAt=? WHERE _id=?", [Date.now(), previous._id]);
    }
    await run("UPDATE commitments SET status=?,title=?,party=?,amountMinor=?,currency=?,dueDate=?,conditions=?,supersedesId=?,updatedAt=? WHERE _id=?", [status, nameSchema.parse(args.title ?? old.title), nameSchema.parse(args.party ?? old.party), amountMinor, currency, dueDate, z.string().max(20000).parse(args.conditions ?? old.conditions), args.supersedesId ?? old.supersedesId, Date.now(), old._id]);
    return null;
  };
  const addInvoice = async (args: Scope & { reference: string; amount: string; currency: string; dueDate?: string; documentId?: string }) => {
    engagement(args); const currency = currencySchema.parse(args.currency), amount = parseMoney(args.amount, currency); if (amount <= 0) throw new Error("Invoice amount must be positive.");
    if (args.documentId && !data.obligationDocuments.some(d => d._id === args.documentId && d.engagementId === args.engagementId && d.workspaceId === args.workspaceId)) throw new Error("Invoice source not found.");
    const id = nanoid(); await run("INSERT INTO obligationInvoices VALUES (?,?,?,?,?,?,?,?,?,?)", [id, args.workspaceId, args.engagementId, args.documentId ?? null, nameSchema.parse(args.reference), amount, currency, args.dueDate ? dateOnly(args.dueDate) : null, "issued", Date.now()]); return id;
  };
  const allocate = async (args: Scope & { paymentId: string; invoiceId: string; amount: string }) => {
    engagement(args);
    const [payment] = await select<PaymentDoc>("SELECT * FROM obligationPayments WHERE _id=? AND workspaceId=? AND engagementId=?", [args.paymentId, args.workspaceId, args.engagementId]);
    const [invoice] = await select<InvoiceDoc>("SELECT * FROM obligationInvoices WHERE _id=? AND workspaceId=? AND engagementId=? AND state='issued'", [args.invoiceId, args.workspaceId, args.engagementId]);
    if (!payment || !invoice || payment.currency !== invoice.currency) throw new Error("Choose a payment and invoice in this engagement with the same currency.");
    const amount = parseMoney(args.amount, payment.currency); if (amount <= 0) throw new Error("Allocation must be positive.");
    const [allocated] = await select<{ total: number }>("SELECT COALESCE(SUM(amountMinor),0) total FROM paymentAllocations WHERE paymentId=? AND invoiceId<>?", [payment._id, invoice._id]);
    if (allocated.total + amount > payment.amountMinor) throw new Error("Allocation exceeds the payment amount.");
    const [net] = await select<{ total: number }>("SELECT COALESCE(SUM(a.amountMinor * CASE WHEN p.kind='refund' THEN -1 ELSE 1 END),0) total FROM paymentAllocations a JOIN obligationPayments p ON p._id=a.paymentId WHERE a.invoiceId=? AND a.paymentId<>?", [invoice._id, payment._id]);
    if (payment.kind === "receipt" && net.total + amount > invoice.amountMinor) throw new Error("Allocation exceeds the invoice balance. Leave the excess unallocated.");
    if (payment.kind === "receipt") {
      const [refunds] = await select<{ total: number }>("SELECT COALESCE(SUM(a.amountMinor),0) total FROM paymentAllocations a JOIN obligationPayments p ON p._id=a.paymentId WHERE p.receiptId=? AND a.invoiceId=?", [payment._id, invoice._id]);
      if (amount < refunds.total) throw new Error("Allocation cannot fall below refunds already allocated against this receipt.");
    }
    if (payment.kind === "refund") {
      const [receiptAllocation] = await select<{ amountMinor: number }>("SELECT amountMinor FROM paymentAllocations WHERE paymentId=? AND invoiceId=?", [payment.receiptId, invoice._id]);
      const [otherRefunds] = await select<{ total: number }>("SELECT COALESCE(SUM(a.amountMinor),0) total FROM paymentAllocations a JOIN obligationPayments p ON p._id=a.paymentId WHERE p.receiptId=? AND a.invoiceId=? AND p._id<>?", [payment.receiptId, invoice._id, payment._id]);
      if (!receiptAllocation || amount + otherRefunds.total > receiptAllocation.amountMinor || net.total - amount < 0) throw new Error("Refund exceeds the original receipt allocated to this invoice.");
    }
    await run("INSERT INTO paymentAllocations VALUES (?,?,?,?,?) ON CONFLICT(paymentId,invoiceId) DO UPDATE SET amountMinor=excluded.amountMinor", [nanoid(), args.workspaceId, payment._id, invoice._id, amount]); return null;
  };
  const recordPayment = async (args: Scope & { reference: string; amount: string; currency: string; date: string; kind?: "receipt" | "refund"; receiptId?: string; invoiceId?: string }) => {
    const client = engagement(args); const reference = nameSchema.parse(args.reference), currency = currencySchema.parse(args.currency), amountMinor = parseMoney(args.amount, currency), kind = z.enum(["receipt", "refund"]).parse(args.kind ?? "receipt");
    dateOnly(args.date); if (amountMinor <= 0) throw new Error("Payment amount must be positive.");
    if (kind === "receipt" && args.receiptId) throw new Error("Select an original receipt only when recording a refund.");
    const [duplicate] = await select<PaymentDoc>("SELECT * FROM obligationPayments WHERE engagementId=? AND reference=?", [client._id, reference]);
    if (duplicate) { if (duplicate.amountMinor !== amountMinor || duplicate.currency !== currency || duplicate.kind !== kind || duplicate.date !== args.date || duplicate.receiptId !== (args.receiptId ?? null)) throw new Error("That reference already belongs to a different payment."); return duplicate._id; }
    if (kind === "refund") {
      const [receipt] = await select<PaymentDoc>("SELECT * FROM obligationPayments WHERE _id=? AND engagementId=? AND workspaceId=? AND kind='receipt'", [args.receiptId ?? "", client._id, args.workspaceId]);
      const [refunds] = await select<{ total: number }>("SELECT COALESCE(SUM(amountMinor),0) total FROM obligationPayments WHERE receiptId=?", [args.receiptId ?? ""]);
      if (!receipt || receipt.currency !== currency || refunds.total + amountMinor > receipt.amountMinor) throw new Error("Refund exceeds the original receipt or uses a different currency.");
    }
    const itemId = await createItem({ workspaceId: args.workspaceId, title: `${kind === "refund" ? "Refund to" : "Payment from"} ${client.client}: ${reference}`.slice(0, 200), type: kind === "refund" ? "Expense" : "Income", amount: amountMinor / 10 ** currencyDecimals(currency), financialState: kind === "refund" ? "Spent" : "Received", dueDate: args.date, description: `Manually confirmed ${currency} ${args.amount}. Engagement: ${client.name}. Reference: ${reference}.`, parentId: null, areaId: null, status: null, priority: null, tags: ["client", "payment"] });
    const id = nanoid(); await run("INSERT INTO obligationPayments VALUES (?,?,?,?,?,?,?,?,?,?,?)", [id, args.workspaceId, client._id, reference, amountMinor, currency, args.date, kind, args.receiptId ?? null, itemId, Date.now()]);
    if (args.invoiceId) await allocate({ ...args, paymentId: id, invoiceId: args.invoiceId, amount: args.amount }); return id;
  };
  const createFollowup = async (args: Scope & { exceptionKey?: string; commitmentId?: string; dueDate: string }) => {
    const details = obligationDetails(args); dateOnly(args.dueDate);
    let key = args.exceptionKey ?? `commitment:${args.commitmentId}`, title = "", description = "";
    if (args.commitmentId) { const c = details.commitments.find(c => c._id === args.commitmentId && c.status === "accepted"); if (!c) throw new Error("Accept this obligation before making a task."); title = c.title; description = `Source: ${c.documentId}\n${c.quote}\n${c.conditions}`; }
    else { const issue = details.exceptions.find(e => e.key === args.exceptionKey); if (!issue) throw new Error("Exception no longer applies."); title = issue.title; description = `${issue.detail}\nSources: ${issue.sourceIds.join(", ")}`; }
    const [existing] = await select<{ itemId: string }>("SELECT itemId FROM obligationFollowups WHERE workspaceId=? AND exceptionKey=?", [args.workspaceId, key]); if (existing) return existing.itemId;
    const itemId = await createItem({ workspaceId: args.workspaceId, title: title.slice(0, 200), description, type: "Task", status: "Todo", areaId: null, parentId: null, priority: 2, dueDate: args.dueDate, amount: null, financialState: null, tags: ["client", "waiting"] });
    await run("INSERT INTO obligationFollowups VALUES (?,?,?,?,?)", [nanoid(), args.workspaceId, args.engagementId, key, itemId]);
    if (args.commitmentId) await run("UPDATE commitments SET itemId=? WHERE _id=?", [itemId, args.commitmentId]); return itemId;
  };
  return { create, addDocument, extract, review, addInvoice, recordPayment, allocate, createFollowup };
}
