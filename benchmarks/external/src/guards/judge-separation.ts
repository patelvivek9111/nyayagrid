export type JudgeSeparationOptions = {
  responseModel: string;
  judgeModel: string;
  allowSelfGrade?: boolean;
};

export class JudgeSeparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JudgeSeparationError";
  }
}

export function assertJudgeSeparation(options: JudgeSeparationOptions): void {
  const { responseModel, judgeModel, allowSelfGrade = false } = options;
  if (allowSelfGrade) {
    return;
  }
  if (responseModel.trim() === judgeModel.trim()) {
    throw new JudgeSeparationError(
      "responseModel and judgeModel must differ unless allowSelfGrade is explicitly true",
    );
  }
}
