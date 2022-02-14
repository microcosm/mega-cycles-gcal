class CopySheetEventsToCalendar extends Feature {
  constructor(sheet) {
    super(sheet, 'Copy Sheet Events To Calendar');
    this.addResponseCapability(Event.onSpreadsheetOpen);
    this.addResponseCapability(Event.onSheetEdit);
    this.addResponseCapability(Event.onOvernightTimer);
    this.addResponseCapability(Event.onHourTimer);
    this.addResponseCapability(Event.onSidebarSubmit);
  }

  execute() {
    super.execute();
    this.eventsFromUserCalendarsStateBuilder = new EventsFromUserCalendarsStateBuilder(this);
    this.eventsFromSheetStateBuilder = new EventsFromSheetStateBuilder(this);
    state.users.forEach((user) => {
      if(this.isValidUser(user)) {
        user.calendarEvents = this.eventsFromUserCalendarsStateBuilder.build(user);
        user.sheetEvents = this.eventsFromSheetStateBuilder.build(user);
        this.updateCalendar(user);
      }
    });
  }

  updateCalendar(user) {
    logString(`Calendar update for user '` + user.name + `'`);
    startLogBlock();
    logString(`Discovering...`);
    this.discoverMatchingEvents(user);
    logString(`Deleting...`);
    this.deleteUnmatchedCalendarEvents(user);
    logString(`Creating...`);
    this.createUnmatchedSheetEvents(user);
    endLogBlock();
  }

  isValidUser(user) {
    return !isProperty(this.config.username) || user.name === this.config.username;
  }

  discoverMatchingEvents(user) {
    user.sheetEvents.forEach((sheetEvent) => {
      var matchingCalendarEvent = this.findInCalendarEvents(sheetEvent, user.calendarEvents);
      if(matchingCalendarEvent) {
        matchingCalendarEvent.existsInSheet = true;
        sheetEvent.existsInCalendar = true;
      }
      logCalendarEventFound(sheetEvent, matchingCalendarEvent);
    });
  }

  deleteUnmatchedCalendarEvents(user) {
    user.calendarEvents.forEach((calendarEvent) => {
      if(!calendarEvent.existsInSheet){
        this.deleteCalendarEvent(calendarEvent);
      }
    });
  }

  createUnmatchedSheetEvents(user) {
    user.sheetEvents.forEach((sheetEvent) => {
      if(!sheetEvent.existsInCalendar) {
        this.createCalendarEvent(sheetEvent, user.calendar);
      }
    });
  }

  findInCalendarEvents(sheetEvent, calendarEvents) {
    var match = false;
    calendarEvents.forEach((calendarEvent) => {
      var isEqual =
        calendarEvent.title === sheetEvent.title &&
        calendarEvent.startDateTime.getTime() === sheetEvent.startDateTime.getTime() &&
        calendarEvent.isAllDay === sheetEvent.isAllDay &&
        (calendarEvent.isAllDay ? true : calendarEvent.endDateTime.getTime() === sheetEvent.endDateTime.getTime()) &&
        calendarEvent.options.location === sheetEvent.options.location;
      if(isEqual) {
        match = calendarEvent;
      }
    });
    return match;
  }

  deleteCalendarEvent(calendarEvent) {
    logCalendarEventDeleted(calendarEvent);
    if(state.toggles.performDataUpdates) {
      calendarEvent.gcal.deleteEvent();
    }
  }

  createCalendarEvent(sheetEvent, calendar) {
    logCalendarEventCreated(sheetEvent);
    if(state.toggles.performDataUpdates) {
      sheetEvent.isAllDay ?
        calendar.createAllDayEvent(sheetEvent.title, sheetEvent.startDateTime, sheetEvent.options) :
        calendar.createEvent(sheetEvent.title, sheetEvent.startDateTime, sheetEvent.endDateTime, sheetEvent.options);
    }
  }
}

class EventsFromUserCalendarsStateBuilder {
  constructor(feature) {
    this.sheet = feature.sheet;
  }

  build(user, fromDate=new Date('January 1, 2000'), toDate=new Date('January 1, 3000')) {
    const googleCalendarEvents = user.calendar.getEvents(fromDate, toDate);
    var calendarEvents = [];
    googleCalendarEvents.filter(e => e.getLocation().startsWith(this.sheet.name)).forEach((e) => {
      calendarEvents.push({
        title: e.getTitle(),
        startDateTime: e.getStartTime(),
        endDateTime: e.getEndTime(),
        isAllDay: e.isAllDayEvent(),
        existsInSheet: false,
        options: {
          description: e.getDescription(),
          location: e.getLocation()
        },
        gcal: e,
        gcalId: e.getId()
      });
    });
    return calendarEvents;
  }
}

class EventsFromSheetStateBuilder {
  constructor(feature) {
    this.sheet = feature.sheet;
    this.config = feature.config;
    this.workDateLabel = this.config.workDateLabel;
    this.workDateLabelLength = this.config.workDateLabel.length;
    this.currentWidgetName = '';
    this.fillInTheBlanksDate = state.today;
  }

  build(user) {
    this.events = [];
    this.user = user;
    this.exclusionListNames = this.getOtherUsersNames(user);
    for(var widgetCategoryKey in this.config.widgetCategories) {
      this.widgetCategoryName = widgetCategoryKey;
      this.widgetCategory = this.config.widgetCategories[widgetCategoryKey];
      this.columns = this.widgetCategory.columns.zeroBasedIndices;
      this.buildEventsFromWidgetCategory();
    }
    return this.events;
  }

  buildEventsFromWidgetCategory() {
    const sheetValues = this.sheet.getValues();
    for(var i = 0; i < sheetValues.length; i++) {
      const row = sheetValues[i];

      if(this.isWorkDateLabel(row[this.columns.workDate])) {
        this.currentWidgetName = sheetValues[i + this.widgetCategory.name.rowOffset][this.widgetCategory.name.column.zeroBasedIndex];
      } else if(this.isValidEvent(row)) {
        var eventFromSheet = this.buildEventFromRow(row);
        this.events.push(eventFromSheet);
      }
    }
  }

  isWorkDateLabel(str) {
    return typeof str == 'string' && str.substring(0, this.workDateLabelLength) === this.workDateLabel;
  }

  isValidEvent(row) {
    var check = {
      isNounColValidString:     typeof row[this.columns.noun] == 'string' && row[this.columns.noun].length > 0,
      isVerbColValidString:     typeof row[this.columns.verb] == 'string' && row[this.columns.verb].length > 0,
      isValidDate:              this.widgetCategory.allowFillInTheBlanksDates || row[this.columns.workDate] instanceof Date,
      isValidUser:              !this.exclusionListNames.includes(row[this.columns.name]),
      isValidWidget:            typeof this.config.widgetValidator === "undefined" || this.config.widgetValidator.method(this.currentWidgetName, this.sheet, this.config.widgetValidator.data),
      isValidEventData:         typeof this.config.eventValidator === "undefined" || this.config.eventValidator.method(row, this.config.eventValidator.data, this.widgetCategory.columns, this.widgetCategoryName)
    };
    return Object.values(check).every(is => is === true);
  }

  buildEventFromRow(row) {
    var startDateTime, endDateTime, isAllDay;

    if(this.isFillInTheBlanks(row, this.widgetCategory)) {
      isAllDay = true;
      startDateTime = new Date(this.fillInTheBlanksDate);
      endDateTime = null;
    } else {
      const startTime = row[this.columns.startTime];
      const startTimeHours = this.getStartTimeHours(startTime);
      const startTimeMinutes = this.getStartTimeMinutes(startTime);
      const durationHours = row[this.columns.durationHours];
      isAllDay = this.getIsAllDay(startTimeHours, startTimeMinutes, durationHours);
      startDateTime = new Date(row[this.columns.workDate]);
      startDateTime = this.getPulledForward(startDateTime);

      if(isAllDay) {
        endDateTime = null;
      } else {
        startDateTime.setHours(startTimeHours);
        startDateTime.setMinutes(startTimeMinutes);
        startDateTime.setSeconds(0);
        startDateTime.setMilliseconds(0);
        endDateTime = new Date(startDateTime);
        endDateTime.setHours(endDateTime.getHours() + durationHours);
        endDateTime.setMinutes((durationHours - Math.floor(durationHours)) * 60);
        endDateTime.setSeconds(0);
        endDateTime.setMilliseconds(0);
      }
    }

    return {
      title: row[this.columns.noun] + ': ' + row[this.columns.verb],
      startDateTime: startDateTime,
      endDateTime: endDateTime,
      isAllDay: isAllDay,
      options: {
        description: this.generateDescription(row),
        location: this.sheet.name + '.' + this.currentWidgetName,
        guests: this.user.inviteEmail
      },
      isAlreadyInCalendar: false
    };
  }

  getIsAllDay(startTimeHours, startTimeMinutes, durationHours) {
    return !(
      isValidNumber(startTimeHours) && startTimeHours >= 0 && startTimeHours <= 23 &&
      isValidNumber(startTimeMinutes) && startTimeMinutes >= 0 && startTimeMinutes <= 59 &&
      isValidNumber(durationHours) && durationHours > 0
    );
  }

  getStartTimeHours(startTime) {
    return isValidTimeString(startTime) ? startTime.split(':')[0] : false;
  }

  getStartTimeMinutes(startTime) {
    return isValidTimeString(startTime) ? startTime.split(':')[1] : false;
  }

  isFillInTheBlanks(row, widgetCategory) {
    return widgetCategory.allowFillInTheBlanksDates && (!(row[this.columns.workDate] instanceof Date));
  }

  getPulledForward(dateTime) {
    if(dateTime < state.today) {
      var pulledForwardDate = new Date(dateTime);
      pulledForwardDate.setFullYear(state.today.getFullYear());
      pulledForwardDate.setMonth(state.today.getMonth());
      pulledForwardDate.setDate(state.today.getDate());
      return pulledForwardDate;
    }
    return dateTime;
  }

  getOtherUsersNames(user) {
    var otherNames = [];
    state.users.forEach((possibleOther) => {
      if(possibleOther.name != user.name) {
        otherNames.push(possibleOther.name);
      }
    });
    return otherNames;
  }

  generateDescription(row) {
    var nameStr = this.columns.name === undefined ? '' : ' for ' + row[this.columns.name];

    return 'This event is from the "' + this.currentWidgetName + '" widget' + nameStr +
      '.\n\nCreated by <a href="https://docs.google.com/spreadsheets/d/' + state.spreadsheet.id +
      '/edit?usp=sharing' +
      (isProperty(this.config.sheetIdForUrl) ? '#gid=' + this.config.sheetIdForUrl : '') +
      '">' + state.spreadsheet.name + '</a>&nbsp;&larr; Click here for more';
  }
}