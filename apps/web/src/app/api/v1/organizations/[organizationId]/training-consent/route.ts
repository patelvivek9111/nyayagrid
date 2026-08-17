import { recordTrainingConsentSchema } from "@nyayagrid/validation";
import { requireCapability } from "@nyayagrid/permissions";
import {
  getActiveTrainingConsent,
  recordTrainingConsent,
  withdrawTrainingConsent,
} from "@nyayagrid/platform";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { organizationId } = await params;
    const { db, user } = await requireUser(request.headers);
    await requireCapability(db, {
      userId: user.id,
      organizationId,
      capability: "compliance.manage",
    });
    const consent = await getActiveTrainingConsent({ db, organizationId });
    return jsonOk({
      consented: Boolean(consent),
      consent,
      trainsOnCustomerData: false,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { organizationId } = await params;
    const { db, user } = await requireUser(request.headers);
    await requireCapability(db, {
      userId: user.id,
      organizationId,
      capability: "compliance.manage",
    });
    const body = recordTrainingConsentSchema.parse(await request.json());
    const consent = await recordTrainingConsent({
      db,
      organizationId,
      userId: user.id,
      statement: body.statement,
    });
    return jsonOk({ consent, trainsOnCustomerData: false }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { organizationId } = await params;
    const { db, user } = await requireUser(request.headers);
    await requireCapability(db, {
      userId: user.id,
      organizationId,
      capability: "compliance.manage",
    });
    const consent = await withdrawTrainingConsent({
      db,
      organizationId,
      userId: user.id,
    });
    return jsonOk({ consent, consented: false, trainsOnCustomerData: false });
  } catch (error) {
    return handleRouteError(error);
  }
}
