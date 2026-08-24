function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function paginatedResponse(data, total, { page, limit }) {
  return { data, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
}

module.exports = { parsePagination, paginatedResponse };
