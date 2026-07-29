const ROLES = {
  ADMIN: 'admin',
  COMMUNICATION_OFFICER: 'communication_officer',
  EDITOR: 'editor',
  BROADCAST_CONTENT_CREATOR: 'broadcast_content_creator',
  SOCIAL_MEDIA_CONTENT_CREATOR: 'social_media_content_creator',
};

const ALL_ROLES = Object.values(ROLES);

/** Roles that can approve/reject blogs */
const REVIEWERS = [ROLES.ADMIN, ROLES.COMMUNICATION_OFFICER, ROLES.EDITOR];

/** Roles that can publish/unpublish blogs to the live site */
const PUBLISHERS = [ROLES.ADMIN, ROLES.COMMUNICATION_OFFICER];

/** Roles that can view/edit users and review profiles */
const USER_MANAGERS = [ROLES.ADMIN, ROLES.COMMUNICATION_OFFICER];

/** Roles that can upgrade roles, deactivate, and delete users */
const ROLE_MANAGERS = [ROLES.ADMIN];

/** Roles that can create and submit blog posts */
const CREATORS = ALL_ROLES;

/** External content creators */
const EXTERNAL_CREATORS = [
  ROLES.BROADCAST_CONTENT_CREATOR,
  ROLES.SOCIAL_MEDIA_CONTENT_CREATOR,
];

const isReviewer = (role) => REVIEWERS.includes(role);
const isPublisher = (role) => PUBLISHERS.includes(role);
const isUserManager = (role) => USER_MANAGERS.includes(role);
const isRoleManager = (role) => ROLE_MANAGERS.includes(role);
const isCreator = (role) => CREATORS.includes(role);
const isAdmin = (role) => role === ROLES.ADMIN;
const isCommunicationOfficer = (role) => role === ROLES.COMMUNICATION_OFFICER;
const isEditor = (role) => role === ROLES.EDITOR;

module.exports = {
  ROLES,
  ALL_ROLES,
  REVIEWERS,
  PUBLISHERS,
  USER_MANAGERS,
  ROLE_MANAGERS,
  CREATORS,
  EXTERNAL_CREATORS,
  isReviewer,
  isPublisher,
  isUserManager,
  isRoleManager,
  isCreator,
  isAdmin,
  isCommunicationOfficer,
  isEditor,
};