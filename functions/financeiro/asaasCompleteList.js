"use strict";

// Offset pagination is not a provider snapshot. Reject inconsistent metadata,
// truncation, repetition or changing totals; never return a partial array.
function incomplete(reason) {
  const error = new Error("asaas_list_inconclusive");
  error.code = "asaas_list_inconclusive";
  error.reason = reason;
  return error;
}
async function readCompleteAsaasList({get, url, headers, params = {}, pageSize = 100, maxPages = 20}) {
  if (typeof get !== "function" || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
      !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw incomplete("invalid_reader_contract");
  const rows = [], seen = new Set();
  let total = null;
  for (let page = 0; page < maxPages; page++) {
    const offset = rows.length;
    const response = await get(url, {headers, params: {...params, offset, limit: pageSize}});
    const data = response?.data;
    if (!data || !Array.isArray(data.data) || typeof data.hasMore !== "boolean" ||
        !Number.isSafeInteger(data.totalCount) || data.totalCount < 0 || data.offset !== offset || data.limit !== pageSize ||
        data.data.length > pageSize) throw incomplete("missing_or_invalid_page_metadata");
    if (total !== null && data.totalCount !== total) throw incomplete("total_changed");
    total = data.totalCount;
    if (total > pageSize * maxPages) throw incomplete("bounded_read_exceeded");
    for (const row of data.data) {
      if (!row || typeof row.id !== "string" || !row.id || seen.has(row.id)) throw incomplete("invalid_or_repeated_identity");
      seen.add(row.id); rows.push(row);
    }
    if (rows.length > total || data.hasMore !== (rows.length < total)) throw incomplete("count_or_continuation_mismatch");
    if (!data.hasMore) return rows;
    if (data.data.length === 0) throw incomplete("empty_page_with_continuation");
  }
  throw incomplete("page_limit_exceeded");
}
async function completeListResponse(get, url, options) {
  const rows = await readCompleteAsaasList({get, url, headers: options.headers, params: options.params});
  return {data: {data: rows, hasMore: false, totalCount: rows.length}};
}
module.exports = {readCompleteAsaasList, completeListResponse};
