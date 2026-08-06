payload.sub, username: payload.username, fullName: payload.fullName, role: payload.role };
  next();
}

/** Exige une permission précise. */
export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(HttpError.unauthorized());
    if (!roleHas(req.auth.role, permission)) {
      return next(HttpError.forbidden(`Permission requise : ${permission}`));
    }
    next();
  };
}

/** Exige l'un des rôles listés. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(HttpError.unauthorized());
    if (!roles.includes(req.auth.role)) return next(HttpError.forbidden());
    next();
  };
}
