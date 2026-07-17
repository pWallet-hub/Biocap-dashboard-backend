const { ALL_ROLES } = require('../constants/roles');

const PROFILE_FIELDS = [
  'username',
  'firstName',
  'lastName',
  'dateOfBirth',
  'organization',
  'organizationLink',
  'socialHandle',
];

const pickProfileFields = (body, allowed = PROFILE_FIELDS) => {
  const picked = {};
  for (const key of allowed) {
    if (body[key] !== undefined) picked[key] = body[key];
  }
  return picked;
};

const validateRole = (role) => {
  if (!ALL_ROLES.includes(role)) {
    const err = new Error(`role must be one of: ${ALL_ROLES.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }
};

const validateRoleSpecificFields = (role, data) => {
  if (role === 'broadcast_media' && !data.organizationLink) {
    const err = new Error('organizationLink is required for broadcast_media accounts');
    err.statusCode = 400;
    throw err;
  }
};

const USER_REVIEW_DECISIONS = ['verified', 'needs_attention', 'noted'];

const validateUserReview = ({ decision, note }) => {
  if (!USER_REVIEW_DECISIONS.includes(decision)) {
    const err = new Error(`decision must be one of: ${USER_REVIEW_DECISIONS.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }
  if (decision === 'needs_attention' && !note?.trim()) {
    const err = new Error('A note is required when flagging a user as needs_attention');
    err.statusCode = 400;
    throw err;
  }
};

module.exports = {
  PROFILE_FIELDS,
  pickProfileFields,
  validateRole,
  validateRoleSpecificFields,
  USER_REVIEW_DECISIONS,
  validateUserReview,
};
