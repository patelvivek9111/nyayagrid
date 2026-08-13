import { eq } from "drizzle-orm";
import { createOrganizationWithDefaults, organizations, memberships } from "@nyayagrid/database";
import { createOrganizationSchema } from "@nyayagrid/validation";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { createLogger } from "@nyayagrid/observability";

const log = createLogger("api.organizations");

export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const rows = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        type: organizations.type,
        membershipId: memberships.id,
      })
      .from(memberships)
      .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
      .where(eq(memberships.userId, user.id));

    return jsonOk({ organizations: rows });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const body = createOrganizationSchema.parse(await request.json());
    const created = await createOrganizationWithDefaults(db, {
      name: body.name,
      slug: body.slug,
      type: body.type,
      ownerUserId: user.id,
    });

    await writeAuditEvent(db, {
      organizationId: created.organization.id,
      actorUserId: user.id,
      action: "organization.created",
      targetType: "organization",
      targetId: created.organization.id,
      metadata: { type: body.type, slug: body.slug },
    });

    log.info("organization created", {
      organizationId: created.organization.id,
      actorUserId: user.id,
    });

    return jsonOk({ organization: created.organization }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
