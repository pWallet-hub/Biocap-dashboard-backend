const ROLES = {
  ADMIN: 'admin',
  COMMUNICATION_OFFICER: 'communication_officer',
  BROADCAST_MEDIA: 'broadcast_media',
  SOCIAL_MEDIA_INFLUENCER: 'social_media_influencer',
};

const ALL_ROLES = Object.values(ROLES);

/** Roles that can approve, reject, and publish blogs */
const REVIEWERS = [ROLES.ADMIN, ROLES.COMMUNICATION_OFFICER];

/** Roles that can create and submit blog posts */
const CREATORS = ALL_ROLES;

/** Content creators excluding staff — used for user review scope */
const EXTERNAL_CREATORS = [ROLES.BROADCAST_MEDIA, ROLES.SOCIAL_MEDIA_INFLUENCER];

const isReviewer = (role) => REVIEWERS.includes(role);
const isCreator = (role) => CREATORS.includes(role);
const isAdmin = (role) => role === ROLES.ADMIN;
const isCommunicationOfficer = (role) => role === ROLES.COMMUNICATION_OFFICER;

module.exports = {
  ROLES,
  ALL_ROLES,
  REVIEWERS,
  CREATORS,
  EXTERNAL_CREATORS,
  isReviewer,
  isCreator,
  isAdmin,
  isCommunicationOfficer,
};
