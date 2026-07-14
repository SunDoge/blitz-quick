use crate::applier::GenerationNode;
use crate::protocol::Op;
use blitz_dom::Attribute;
use blitz_dom::{DocumentMutator, LocalName, QualName, ns};
use std::collections::{HashMap, HashSet};

fn qual(tag: &str) -> QualName {
    QualName::new(None, ns!(html), LocalName::from(tag))
}

pub fn apply_op(
    mutr: &mut DocumentMutator<'_>,
    id_map: &mut Vec<Option<GenerationNode>>,
    blitz_to_solid: &mut HashMap<usize, u32>,
    listeners: &mut HashMap<u32, HashSet<u8>>,
    op: &Op<'_>,
) {
    let get = |id_map: &Vec<Option<GenerationNode>>, id: u32| -> Option<usize> {
        let slot = (id & 0xFFFFF) as usize;
        let generation = (id >> 20) as u16;
        if let Some(Some(node)) = id_map.get(slot)
            && node.generation == generation
        {
            return Some(node.blitz_id);
        }
        None
    };
    let insert = |id_map: &mut Vec<Option<GenerationNode>>, id: u32, blitz_id: usize| {
        let slot = (id & 0xFFFFF) as usize;
        let generation = (id >> 20) as u16;
        if id_map.len() <= slot {
            id_map.resize(slot + 1, None);
        }
        id_map[slot] = Some(GenerationNode {
            generation,
            blitz_id,
        });
    };
    match op {
        Op::CreateElement { id, tag, attrs } => {
            let qname = qual(tag);
            let attrs: Vec<Attribute> = attrs
                .iter()
                .map(|(n, v)| Attribute {
                    name: qual(n),
                    value: v.to_string(),
                })
                .collect();
            let blitz_id = mutr.create_element(qname, attrs);
            insert(id_map, *id, blitz_id);
            blitz_to_solid.insert(blitz_id, *id);
        }
        Op::CreateText { id, text } => {
            let blitz_id = mutr.create_text_node(text);
            insert(id_map, *id, blitz_id);
            blitz_to_solid.insert(blitz_id, *id);
        }
        Op::CreateComment { id, .. } => {
            let blitz_id = mutr.create_comment_node();
            insert(id_map, *id, blitz_id);
            blitz_to_solid.insert(blitz_id, *id);
        }
        Op::AppendChild { parent, child } => {
            let (p, c) = match (get(id_map, *parent), get(id_map, *child)) {
                (Some(p), Some(c)) => (p, c),
                _ => return,
            };
            mutr.append_children(p, &[c]);
        }
        Op::InsertBefore {
            parent,
            child,
            ref_id,
        } => {
            let (p, c) = match (get(id_map, *parent), get(id_map, *child)) {
                (Some(p), Some(c)) => (p, c),
                _ => return,
            };
            if *ref_id == 0 {
                mutr.append_children(p, &[c]);
            } else if let Some(r) = get(id_map, *ref_id) {
                mutr.insert_nodes_before(r, &[c]);
            } else {
                mutr.append_children(p, &[c]);
            }
        }
        Op::RemoveChild { child, .. } => {
            if let Some(c) = get(id_map, *child) {
                mutr.remove_node(c);
            }
        }
        Op::ReplaceNode { old_id, new_id, .. } => {
            if let (Some(old), Some(new)) = (get(id_map, *old_id), get(id_map, *new_id)) {
                mutr.replace_node_with(old, &[new]);
            }
        }
        Op::SetText { id, text } => {
            if let Some(n) = get(id_map, *id) {
                mutr.set_node_text(n, text);
            }
        }
        Op::SetAttribute { id, name, value } => {
            if let Some(n) = get(id_map, *id) {
                if *name == "class" || *name == "className" {
                    mutr.set_attribute(n, qual("class"), value);
                } else {
                    mutr.set_attribute(n, qual(name), value);
                }
            }
        }
        Op::RemoveAttribute { id, name } => {
            if let Some(n) = get(id_map, *id) {
                let nm = if *name == "className" { "class" } else { name };
                mutr.clear_attribute(n, qual(nm));
            }
        }
        Op::SetStyle { id, prop, value } => {
            if let Some(n) = get(id_map, *id) {
                mutr.set_style_property(n, prop, value);
            }
        }
        Op::RemoveStyle { id, prop } => {
            if let Some(n) = get(id_map, *id) {
                mutr.remove_style_property(n, prop);
            }
        }
        Op::AddEventListener { id, event_type } => {
            listeners.entry(*id).or_default().insert(*event_type);
        }
        Op::RemoveEventListener { id, event_type } => {
            if let Some(s) = listeners.get_mut(id) {
                s.remove(event_type);
            }
        }
        Op::SetClassName { id, value } => {
            if let Some(n) = get(id_map, *id) {
                mutr.set_attribute(n, qual("class"), value);
            }
        }
        Op::DropNode { id } => {
            let slot = (*id & 0xFFFFF) as usize;
            let generation = (*id >> 20) as u16;
            if let Some(Some(node)) = id_map.get(slot)
                && node.generation == generation
            {
                mutr.remove_node(node.blitz_id);
                blitz_to_solid.remove(&node.blitz_id);
                id_map[slot] = None;
            }
            listeners.remove(id);
        }
        Op::FrameEnd => {}
    }
}
