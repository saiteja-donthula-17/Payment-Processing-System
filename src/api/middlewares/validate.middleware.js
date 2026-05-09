function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(422).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: result.error.issues.map((i) => ({
          field: i.path.join('.') || '<root>',
          message: i.message,
          code: i.code,
        })),
      });
    }
    req.body = result.data;
    next();
  };
}

module.exports = validate;
