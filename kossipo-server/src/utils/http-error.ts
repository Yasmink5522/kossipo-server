/** Erreur applicative transportant un code HTTP. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'ERREUR',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static badRequest(message: string, details?: unknown) {
    return new HttpError(400, message, 'REQUETE_INVALIDE', details);
  }
  static unauthorized(message = 'Authentification requise') {
    return new HttpError(401, message, 'NON_AUTHENTIFIE');
  }
  static forbidden(message = 'Action non autorisée pour votre profil') {
    return new HttpError(403, message, 'NON_AUTORISE');
  }
  static notFound(message = 'Élément introuvable') {
    return new HttpError(404, message, 'INTROUVABLE');
  }
  static conflict(message: string) {
    return new HttpError(409, message, 'CONFLIT');
  }
}
