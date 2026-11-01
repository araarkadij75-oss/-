/* CRM_UNIT:aiCashDay-73bef13077f1 */
function aiCashDay(r){return shiftCashRecordedDate(r)}/* CRM_END:aiCashDay-73bef13077f1 */
/* CRM_UNIT:aiIsCashClosed-35465e8b83f1 */
function aiIsCashClosed(r){return derivedStage(r)==='Выполнен'&&payrollOrderCashRecorded(r)&&!!aiCashDay(r)}/* CRM_END:aiIsCashClosed-35465e8b83f1 */
