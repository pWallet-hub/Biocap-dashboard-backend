const ROLES = {
  ADMIN: 'admin',
  COMMUNICATION_OFFICER: 'communication_officer',
  EDITOR: 'editor',
  SOCIAL_MEDIA_CONTENT_CREATOR: 'social_media_content_creator',
  MEDIA_CORRESPONDENT: 'media_correspondent',
  PRINCIPAL_INVESTIGATOR: 'principal_investigator',
  // Preserved alias so existing database queries don't break
  BROADCAST_CONTENT_CREATOR: 'media_correspondent',
};

const ALL_ROLES = [
  ROLES.ADMIN,
  ROLES.COMMUNICATION_OFFICER,
  ROLES.EDITOR,
  ROLES.SOCIAL_MEDIA_CONTENT_CREATOR,
  ROLES.MEDIA_CORRESPONDENT,
  ROLES.PRINCIPAL_INVESTIGATOR,
];

/** Official Rwanda BioCap Partner Institutions */
const ORGANIZATIONS = [
  'International Potato Center (CIP)',
  'International Institute of Tropical Agriculture (IITA)',
  'Donald Danforth Plant Science Center (DDPSC)',
  'Michigan State University (MSU)',
  'Rwanda Agriculture and Animal Resources Development Board (RAB)',
  'Alliance for Science Rwanda (AfS-Rwanda)',
];

/** Roles that can approve/reject blogs */
const REVIEWERS = [ROLES.ADMIN, ROLES.COMMUNICATION_OFFICER, ROLES.EDITOR];

/** Roles that can publish/unpublish blogs to the live site */
// Include `editor` so editors and communication officers can publish
const PUBLISHERS = [ROLES.ADMIN, ROLES.COMMUNICATION_OFFICER, ROLES.EDITOR];

/** Roles that can view/edit users and review profiles */
const USER_MANAGERS = [ROLES.ADMIN, ROLES.COMMUNICATION_OFFICER];

/** Roles that can upgrade roles, deactivate, and delete users */
const ROLE_MANAGERS = [ROLES.ADMIN];

/** Roles that can create and submit blog posts */
const CREATORS = ALL_ROLES;

/** External content creators */
const EXTERNAL_CREATORS = [
  ROLES.MEDIA_CORRESPONDENT,
  ROLES.SOCIAL_MEDIA_CONTENT_CREATOR,
  ROLES.PRINCIPAL_INVESTIGATOR,
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
  ORGANIZATIONS,
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