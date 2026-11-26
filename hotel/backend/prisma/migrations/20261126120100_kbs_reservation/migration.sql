-- AddForeignKey
ALTER TABLE "KbsNotification" ADD CONSTRAINT "KbsNotification_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

