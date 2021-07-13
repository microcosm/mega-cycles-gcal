var state;

function onTimedTrigger() {
  init(SpreadsheetApp.openById(config.gsheet.id));
  run();
}

function onEditInstalledTrigger(e) {
  init(SpreadsheetApp.getActiveSpreadsheet());
  if(!isValidTrigger(e)) return;
  run();
}

function init(spreadsheet) {
  state = {
    spreadsheet: spreadsheet,
    eventCategories: null,
    validEventCategories: [],
    people: [],
    rangeValues: {},
    log: '',
    lock: null,
    errorText: 'Calendar update failed: ',
    workDateLabelText: 'Work date',
    today: getTodaysDate(),
    personValuesSubsheet: null,
    eventSubsheets: []
  };

  preProcessSubsheets();
  populateSubsheetsFromSpreadsheet();
  postProcessSubsheets();

  setPeople();
}

function run() {
  if(!waitForLocks()){
    alertError("couldn't lock script");
    return;
  }
  try {
    updateCalendars();
    outputLog();
  } catch(e) {
    alertError(e);
  } finally {
    releaseLock();
  }
}

function isValidTrigger(e){
  const activeSheetName = state.spreadsheet.getActiveSheet().getName();
  state.eventSubsheets.forEach(function(subsheet) {
    if(activeSheetName === subsheet.name && subsheet.triggerCols.includes(e.range.columnStart)) return true;
  });
  return false;
}

function populateSubsheetsFromSpreadsheet() {
  state.eventSubsheets.forEach(function(subsheet) {
    state.rangeValues[subsheet.name] = subsheet.getRangeValues();
  });
}

function setPeople() {
  const values = state.personValuesSubsheet.tab.getRange(state.personValuesSubsheet.range.start + ':' + state.personValuesSubsheet.range.end).getValues();
  for(var i = 0; i < values.length; i += state.personValuesSubsheet.numValuesPerPerson) {
    if(values[i][0] && values[i + 1][0]){
      const name = values[i][0];
      const inviteEmail = values.length >= i + state.personValuesSubsheet.numValuesPerPerson ? values[i + 2][0] : '';
      const calendar = CalendarApp.getCalendarById(values[i + 1][0]);
      state.people.push({
        name: name,
        calendar: calendar,
        inviteEmail: inviteEmail,
        calendarEvents: getCalendarEvents(calendar),
        spreadsheetEvents: null });
    }
  }
  state.people.forEach(function(person) {
    person.spreadsheetEvents = getSpreadsheetEvents(person);
  });
}

function updateCalendars() {
  state.people.forEach(function(person) {
    linkMatchingEvents(person);
    updateChangedEvents(person);
  });
}

function getTodaysDate() {
  var date = new Date();
  date.setHours(0);
  date.setMinutes(0);
  date.setSeconds(0);
  date.setMilliseconds(0);
  return date;
}

function linkMatchingEvents(person) {
  person.spreadsheetEvents.forEach(function(spreadsheetEvent) {
    var matchingCalendarEvent = findInCalendarEvents(spreadsheetEvent, person.calendarEvents);
    if(matchingCalendarEvent) {
      matchingCalendarEvent.existsInSpreadsheet = true;
      spreadsheetEvent.existsInCalendar = true;
    }
    logEventFound(spreadsheetEvent, matchingCalendarEvent);
  });
  logNewline();
}

function updateChangedEvents(person) {
  deleteOrphanedCalendarEvents(person);
  createNewCalendarEvents(person);
  logNewline();
}

function getIsAllDay(startTime, durationHours) {
  return !(startTime.isANumber() &&
    durationHours.isANumber() &&
    startTime >= 0 &&
    startTime <= 23 &&
    durationHours > 0);
}

function findInCalendarEvents(spreadsheetEvent, calendarEvents) {
  var match = false;
  calendarEvents.forEach(function(calendarEvent) {
    var isEqual =
      calendarEvent.title === spreadsheetEvent.title &&
      calendarEvent.startDateTime.getTime() === spreadsheetEvent.startDateTime.getTime() &&
      calendarEvent.isAllDay === spreadsheetEvent.isAllDay &&
      (calendarEvent.isAllDay ? true : calendarEvent.endDateTime.getTime() === spreadsheetEvent.endDateTime.getTime()) &&
      calendarEvent.options.location === spreadsheetEvent.options.location;
    if(isEqual) {
      match = calendarEvent;
    }
  });
  return match;
}