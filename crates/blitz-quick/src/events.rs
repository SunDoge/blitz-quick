use crate::protocol::{event, event_data};
use blitz_traits::events::{
    BlitzKeyEvent, BlitzPointerEvent, BlitzWheelDelta, BlitzWheelEvent, UiEvent,
};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPayload {
    pub key: String,
    pub code: String,
    pub mods: u32,
}

pub type TranslatedEvent = (
    u8,
    Option<[f64; event_data::LEN]>,
    String,
    Option<(f32, f32)>,
);

pub fn translate_ui_event(event: &UiEvent) -> Option<TranslatedEvent> {
    let mut hit_xy = None;
    let code;
    let mut payload = String::new();
    let mut num_data = None;

    match event {
        UiEvent::PointerUp(e) => {
            code = event::POINTERUP;
            hit_xy = Some((e.coords.client_x, e.coords.client_y));
            num_data = Some(pointer_numeric(e));
        }
        UiEvent::PointerDown(e) => {
            code = event::POINTERDOWN;
            hit_xy = Some((e.coords.client_x, e.coords.client_y));
            num_data = Some(pointer_numeric(e));
        }
        UiEvent::PointerMove(e) => {
            code = event::POINTERMOVE;
            hit_xy = Some((e.coords.client_x, e.coords.client_y));
            num_data = Some(pointer_numeric(e));
        }
        UiEvent::Wheel(e) => {
            code = event::WHEEL;
            hit_xy = Some((e.coords.client_x, e.coords.client_y));
            num_data = Some(wheel_numeric(e));
        }
        UiEvent::KeyDown(e) => {
            code = event::KEYDOWN;
            payload = key_payload(e);
        }
        UiEvent::KeyUp(e) => {
            code = event::KEYUP;
            payload = key_payload(e);
        }
        UiEvent::Ime(e) => {
            if let blitz_traits::events::BlitzImeEvent::Commit(text) = e {
                code = event::IMECOMMIT;
                payload = serde_json::to_string(&serde_json::json!({ "data": text })).unwrap();
            } else {
                return None;
            }
        }
        UiEvent::AppleStandardKeybinding(_) => return None,
        UiEvent::PointerCancel(_) => return None,
    };

    Some((code, num_data, payload, hit_xy))
}

fn pointer_numeric(e: &BlitzPointerEvent) -> [f64; event_data::LEN] {
    let mut data = [0.0; event_data::LEN];
    data[event_data::CLIENT_X as usize] = e.coords.client_x as f64;
    data[event_data::CLIENT_Y as usize] = e.coords.client_y as f64;
    data[event_data::BUTTON as usize] = e.button as u8 as f64;
    data[event_data::BUTTONS as usize] = e.buttons.bits() as f64;
    data[event_data::MODS as usize] = e.mods.bits() as f64;
    data
}

fn wheel_numeric(e: &BlitzWheelEvent) -> [f64; event_data::LEN] {
    let mut data = [0.0; event_data::LEN];
    data[event_data::CLIENT_X as usize] = e.coords.client_x as f64;
    data[event_data::CLIENT_Y as usize] = e.coords.client_y as f64;
    let (dx, dy) = match &e.delta {
        BlitzWheelDelta::Lines(x, y) => ((*x), (*y)),
        BlitzWheelDelta::Pixels(x, y) => (*x, *y),
    };
    data[event_data::DELTA_X as usize] = dx;
    data[event_data::DELTA_Y as usize] = dy;
    data
}

fn key_payload(e: &BlitzKeyEvent) -> String {
    serde_json::to_string(&KeyPayload {
        key: e.key.to_string(),
        code: e.code.to_string(),
        mods: e.modifiers.bits(),
    })
    .unwrap()
}
