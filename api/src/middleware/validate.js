const { ValidationError } = require('../utils/errors');

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const first = result.error.issues[0];
      return next(new ValidationError(`${first.path.join('.')}: ${first.message}`));
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validateBody };
