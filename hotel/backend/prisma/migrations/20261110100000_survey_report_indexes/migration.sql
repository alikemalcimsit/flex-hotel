-- Anket raporu (modül 55): dönemin soru başına puan dökümü ve davet sayımı yalnız indeksten okunur (ölçüm: 1 yıllık
-- raporda cevap tablosunun taraması 0,4–0,6 sn).
DROP INDEX "SurveyAnswer_hotelId_kind_submittedAt_questionId_idx";
DROP INDEX "SurveyInvitation_hotelId_kind_sentAt_idx";
CREATE INDEX "SurveyAnswer_hotelId_kind_submittedAt_questionId_score_idx" ON "SurveyAnswer"("hotelId", "kind", "submittedAt", "questionId", "score");
CREATE INDEX "SurveyInvitation_hotelId_kind_sentAt_openedAt_respondedAt_idx" ON "SurveyInvitation"("hotelId", "kind", "sentAt", "openedAt", "respondedAt");
